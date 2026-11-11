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
const [attester, keeper, treasury, exporter, buyer, lp, gulfFoods] = await Promise.all(["attester", "keeper", "treasury", "exporter", "buyer", "lp", "gulf-foods"].map(n => sub(n)));
const wasm = p => readFileSync(new URL(`../target/near/${p}`, import.meta.url));
const G = 100_000_000_000_000n, Y = 1n;
await usdc.deployContract(wasm("mock_usdc/mock_usdc.wasm"));
await usdc.functionCall({ contractId: usdc.accountId, methodName: "new", args: {}, gas: G });
await core.deployContract(wasm("tradewind/tradewind.wasm"));
await core.functionCall({ contractId: core.accountId, methodName: "new", args: { owner: root.accountId, treasury: treasury.accountId, usdc: usdc.accountId, attester: attester.accountId, keeper: keeper.accountId, config: null }, gas: G });
for (const a of [core, treasury, exporter, buyer, lp, gulfFoods]) await root.functionCall({ contractId: usdc.accountId, methodName: "storage_deposit", args: { account_id: a.accountId, registration_only: true }, gas: 30_000_000_000_000n, attachedDeposit: BigInt(utils.format.parseNearAmount("0.01")) });
await root.functionCall({ contractId: core.accountId, methodName: "lp_allow", args: { account_id: lp.accountId, allowed: true }, gas: 30_000_000_000_000n, attachedDeposit: Y });
await root.functionCall({ contractId: usdc.accountId, methodName: "mint", args: { account_id: lp.accountId, amount: "1000000000" }, gas: 30_000_000_000_000n, attachedDeposit: BigInt(utils.format.parseNearAmount("0.01")) });
await lp.functionCall({ contractId: usdc.accountId, methodName: "ft_transfer_call", args: { receiver_id: core.accountId, amount: "1000000000", msg: JSON.stringify({ action: "deposit" }) }, gas: 150_000_000_000_000n, attachedDeposit: Y });
async function call(signer, contractId, methodName, args, attachedDeposit = 0n, gas = G) {
  return signer.functionCall({ contractId, methodName, args, attachedDeposit, gas });
}
async function seedInvoice(payer, number, advance = false) {
  const face = advance ? "10000000" : "2000000", doc_hash = "0".repeat(64);
  const result = await call(exporter, core.accountId, "create_invoice", { buyer: payer.accountId, buyer_label: "Gulf Foods Trading (sample)", invoice_number: number, face, tenor_days: 60, doc_hash, terms_hash: null }, BigInt(utils.format.parseNearAmount("0.1")));
  if (typeof result.status !== "object" || !("SuccessValue" in result.status)) throw new Error("Seed creation failed");
  const invoice = JSON.parse(Buffer.from(result.status.SuccessValue, "base64").toString());
  await call(attester, core.accountId, "record_verification", { id: invoice.id, v: { verdict: "pass", model_id: "seed-mock", request_hash: doc_hash, response_hash: doc_hash, signature: "MOCK-NOT-A-TEE-SIGNATURE", signing_address: "MOCK", signing_algo: "mock", chat_id: number } });
  await call(payer, core.accountId, "accept_invoice", { id: invoice.id, terms_hash: invoice.terms_hash }, Y);
  if (advance) {
    const preview = await core.viewFunction({ contractId: core.accountId, methodName: "preview_advance", args: { id: invoice.id } });
    if (!preview.eligible) throw new Error(`Showcase not eligible: ${preview.reason}`);
    await call(exporter, core.accountId, "request_advance", { id: invoice.id, expected_terms_hash: invoice.terms_hash, min_advance: preview.advance });
  }
  await call(root, usdc.accountId, "mint", { account_id: payer.accountId, amount: face }, BigInt(utils.format.parseNearAmount("0.00125")));
  for (const amount of advance ? ["6000000", "4000000"] : [face]) await call(payer, usdc.accountId, "ft_transfer_call", { receiver_id: core.accountId, amount, msg: JSON.stringify({ action: "repay", invoice_id: invoice.id, payment_ref: `seed:${number}:${amount}` }) }, Y, 300_000_000_000_000n);
  const repaid = await core.viewFunction({ contractId: core.accountId, methodName: "get_invoice", args: { id: invoice.id } });
  if (repaid.status !== "Repaid") throw new Error(`Seed repayment not confirmed: ${invoice.id}`);
  return invoice.id;
}
// Default counter starts at 35: four Gulf Foods seeds (35..38), three padding
// repayments for a different buyer (39..41), then the showcase (42).
for (let n = 0; n < 7; n++) await seedInvoice(n < 4 ? gulfFoods : buyer, `SEED-MOCK-${n + 1}`);
const showcaseId = await seedInvoice(gulfFoods, "TW-0042", true);
const pool = await core.viewFunction({ contractId: core.accountId, methodName: "get_pool", args: {} });
const env = {
  NEAR_NETWORK: "sandbox", NEAR_RPC_URL: rpc, CORE_CONTRACT_ID: core.accountId, USDC_CONTRACT_ID: usdc.accountId,
  ATTESTER_ACCOUNT_ID: attester.accountId, ATTESTER_PRIVATE_KEY: keys[attester.accountId],
  KEEPER_ACCOUNT_ID: keeper.accountId, KEEPER_PRIVATE_KEY: keys[keeper.accountId], AI_MODE: "mock",
  OWNER_ACCOUNT_ID: root.accountId, OWNER_PRIVATE_KEY: validator.secret_key,
  GUIDED_ENABLED: "1", GUIDED_EXPORTER_ACCOUNT_ID: exporter.accountId, GUIDED_EXPORTER_PRIVATE_KEY: keys[exporter.accountId],
  GUIDED_BUYER_ACCOUNT_ID: buyer.accountId, GUIDED_BUYER_PRIVATE_KEY: keys[buyer.accountId],
  NEXT_PUBLIC_NEAR_NETWORK: "sandbox", NEXT_PUBLIC_NEAR_RPC_URL: rpc, NEXT_PUBLIC_DATA_SOURCE: "rpc",
  NEXT_PUBLIC_CORE_CONTRACT_ID: core.accountId, NEXT_PUBLIC_USDC_CONTRACT_ID: usdc.accountId,
  DATABASE_PATH: "/tmp/tradewind-e2e.db", SESSION_SECRET: "local-e2e-only-" + KeyPair.fromRandom("ed25519").getPublicKey().toString().slice(8, 40),
  SHOWCASE_INVOICE_ID: showcaseId, SHOWCASE_BUYER: gulfFoods.accountId,
};
writeFileSync(out, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
console.log(JSON.stringify({ core: core.accountId, usdc: usdc.accountId, pool }, null, 1));
console.log(`Wrote throwaway local-sandbox env to ${out} (keys are for this local sandbox only; never commit).`);
