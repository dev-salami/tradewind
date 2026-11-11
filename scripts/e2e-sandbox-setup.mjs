// Local-sandbox end-to-end setup: deploys core + mock USDC to a LOCAL near-sandbox,
// creates throwaway demo accounts, seeds the pool, and writes an env file for the web app.
// Never targets testnet/mainnet: refuses any RPC URL that is not localhost.
// Usage: node scripts/e2e-sandbox-setup.mjs <sandbox-home> <rpc-url> <out-env-file>
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { connect, keyStores, KeyPair, utils } = require("near-api-js");
const [home, rpc = "http://127.0.0.1:3039", out = "/tmp/tradewind-e2e.env"] = process.argv.slice(2);
if (!home) throw new Error("usage: e2e-sandbox-setup.mjs <sandbox-home> [rpc-url] [out-env]");
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(rpc)) throw new Error("Refusing non-local RPC: " + rpc);
const validator = JSON.parse(readFileSync(`${home}/validator_key.json`, "utf8"));
const ks = new keyStores.InMemoryKeyStore();
const net = "sandbox";
await ks.setKey(net, validator.account_id, KeyPair.fromString(validator.secret_key));
const near = await connect({ networkId: net, nodeUrl: rpc, keyStore: ks });
const root = await near.account(validator.account_id);
const keys = {};
async function sub(name, nearAmount = "50") {
  const id = `${name}.${validator.account_id}`;
  const kp = KeyPair.fromRandom("ed25519");
  await root.createAccount(id, kp.getPublicKey(), BigInt(utils.format.parseNearAmount(nearAmount)));
  await ks.setKey(net, id, kp); keys[id] = kp.toString();
  return near.account(id);
}
const usdc = await sub("usdc"), core = await sub("core");
const [attester, keeper, treasury, exporter, buyer, lp] = await Promise.all(["attester", "keeper", "treasury", "exporter", "buyer", "lp"].map(n => sub(n)));
const wasm = p => readFileSync(new URL(`../target/near/${p}`, import.meta.url));
const G = 100_000_000_000_000n, Y = 1n;
await usdc.deployContract(wasm("mock_usdc/mock_usdc.wasm"));
await usdc.functionCall({ contractId: usdc.accountId, methodName: "new", args: {}, gas: G });
await core.deployContract(wasm("tradewind/tradewind.wasm"));
await core.functionCall({ contractId: core.accountId, methodName: "new", args: { owner: root.accountId, treasury: treasury.accountId, usdc: usdc.accountId, attester: attester.accountId, keeper: keeper.accountId, config: null }, gas: G });
for (const a of [core, treasury, exporter, buyer, lp]) await root.functionCall({ contractId: usdc.accountId, methodName: "storage_deposit", args: { account_id: a.accountId, registration_only: true }, gas: 30_000_000_000_000n, attachedDeposit: BigInt(utils.format.parseNearAmount("0.01")) });
await root.functionCall({ contractId: core.accountId, methodName: "lp_allow", args: { account_id: lp.accountId, allowed: true }, gas: 30_000_000_000_000n, attachedDeposit: Y });
await root.functionCall({ contractId: usdc.accountId, methodName: "mint", args: { account_id: lp.accountId, amount: "20000000" }, gas: 30_000_000_000_000n, attachedDeposit: BigInt(utils.format.parseNearAmount("0.01")) });
await lp.functionCall({ contractId: usdc.accountId, methodName: "ft_transfer_call", args: { receiver_id: core.accountId, amount: "20000000", msg: JSON.stringify({ action: "deposit" }) }, gas: 150_000_000_000_000n, attachedDeposit: Y });
const pool = await core.viewFunction({ contractId: core.accountId, methodName: "get_pool", args: {} });
const env = {
  NEAR_NETWORK: "sandbox", NEAR_RPC_URL: rpc, CORE_CONTRACT_ID: core.accountId, USDC_CONTRACT_ID: usdc.accountId,
  ATTESTER_ACCOUNT_ID: attester.accountId, ATTESTER_PRIVATE_KEY: keys[attester.accountId],
  KEEPER_ACCOUNT_ID: keeper.accountId, KEEPER_PRIVATE_KEY: keys[keeper.accountId], AI_MODE: "mock",
  GUIDED_ENABLED: "1", GUIDED_EXPORTER_ACCOUNT_ID: exporter.accountId, GUIDED_EXPORTER_PRIVATE_KEY: keys[exporter.accountId],
  GUIDED_BUYER_ACCOUNT_ID: buyer.accountId, GUIDED_BUYER_PRIVATE_KEY: keys[buyer.accountId],
  NEXT_PUBLIC_NEAR_NETWORK: "sandbox", NEXT_PUBLIC_NEAR_RPC_URL: rpc, NEXT_PUBLIC_DATA_SOURCE: "rpc",
  NEXT_PUBLIC_CORE_CONTRACT_ID: core.accountId, NEXT_PUBLIC_USDC_CONTRACT_ID: usdc.accountId,
  DATABASE_PATH: "/tmp/tradewind-e2e.db", SESSION_SECRET: "local-e2e-only-" + KeyPair.fromRandom("ed25519").getPublicKey().toString().slice(8, 40),
};
writeFileSync(out, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
console.log(JSON.stringify({ core: core.accountId, usdc: usdc.accountId, pool }, null, 1));
console.log(`Wrote throwaway local-sandbox env to ${out} (keys are for this local sandbox only; never commit).`);
