// LOCAL near-sandbox only. No live quotes and no real cross-chain funds.
// node scripts/e2e-relayer.mjs <sandbox-home> <setup-env-file> [invoice-id]
import { readFileSync, appendFileSync } from "node:fs";
import { register } from "tsx/esm/api";
import { connect, KeyPair, keyStores, utils } from "near-api-js";
import { startFakeOneClick } from "./fake-oneclick.mjs";
register();
const [home, envFile, requestedInvoice] = process.argv.slice(2);
if (!home || !envFile) throw new Error("Usage: node scripts/e2e-relayer.mjs <sandbox-home> <setup-env-file> [invoice-id]");
for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(.*)$/); if (match) process.env[match[1]] = match[2];
}
const e = process.env, rpc = e.NEAR_RPC_URL;
if (e.NEAR_NETWORK !== "sandbox" || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(rpc || "")) throw new Error("Refusing non-local sandbox RPC");
if (!e.CORE_CONTRACT_ID || !e.USDC_CONTRACT_ID || !e.DATABASE_PATH) throw new Error("Incomplete sandbox setup env");
// The setup's throwaway validator key is used ONLY to create/fund the local subaccount.
const validator = JSON.parse(readFileSync(`${home}/validator_key.json`, "utf8"));
if (validator.account_id !== "test.near") throw new Error("Expected local sandbox test.near validator");
const ks = new keyStores.InMemoryKeyStore(), net = "sandbox";
await ks.setKey(net, validator.account_id, KeyPair.fromString(validator.secret_key));
const near = await connect({ networkId: net, nodeUrl: rpc, keyStore: ks }), root = await near.account(validator.account_id);
const G = 100_000_000_000_000n;
const relayerId = `relayer.${validator.account_id}`;
if (!e.RELAYER_PRIVATE_KEY) {
  const key = KeyPair.fromRandom("ed25519");
  // Persist local credentials before creation so an interrupted run can recover.
  appendFileSync(envFile, `\nRELAYER_ACCOUNT_ID=${relayerId}\nRELAYER_PRIVATE_KEY=${key.toString()}\n`, { mode: 0o600 });
  e.RELAYER_ACCOUNT_ID = relayerId; e.RELAYER_PRIVATE_KEY = key.toString();
}
if (e.RELAYER_ACCOUNT_ID !== relayerId) throw new Error("Expected local relayer.test.near");
const relayerKey = KeyPair.fromString(e.RELAYER_PRIVATE_KEY);
try { await (await near.account(relayerId)).state(); }
catch (error) { if (!String(error).includes("does not exist")) throw error; await root.createAccount(relayerId, relayerKey.getPublicKey(), BigInt(utils.format.parseNearAmount("10"))); }
await ks.setKey(net, relayerId, relayerKey);
const call = (account, contractId, methodName, args, attachedDeposit = 0n) => account.functionCall({ contractId, methodName, args, attachedDeposit, gas: G });
const view = (contractId, methodName, args = {}) => root.viewFunction({ contractId, methodName, args });
await call(root, e.USDC_CONTRACT_ID, "storage_deposit", { account_id: relayerId, registration_only: true }, BigInt(utils.format.parseNearAmount("0.01")));
async function role(prefix) {
  const id = e[`${prefix}_ACCOUNT_ID`], key = e[`${prefix}_PRIVATE_KEY`];
  if (!id || !key) throw new Error(`Missing local ${prefix} env`);
  await ks.setKey(net, id, KeyPair.fromString(key)); return near.account(id);
}
let invoices = [], page;
for (let from = 0; ; from += 50) { page = await view(e.CORE_CONTRACT_ID, "list_invoices", { from_index: String(from), limit: 50 }); invoices.push(...page); if (page.length < 50) break; }
let invoice = requestedInvoice ? invoices.find(i => i.id === requestedInvoice) : invoices.find(i => i.invoice_number === "RELAYER-SIM-001");
if (requestedInvoice && !invoice) throw new Error("Requested invoice not found");
if (!invoice) {
  const exporter = await role("GUIDED_EXPORTER");
  await call(exporter, e.CORE_CONTRACT_ID, "create_invoice", { buyer: e.GUIDED_BUYER_ACCOUNT_ID, buyer_label: "Local simulator buyer", invoice_number: "RELAYER-SIM-001", face: "2000000", tenor_days: 30, doc_hash: "a".repeat(64), terms_hash: null }, BigInt(utils.format.parseNearAmount("0.1")));
  const all = await view(e.CORE_CONTRACT_ID, "list_invoices", { from_index: String(invoices.length), limit: 50 });
  invoice = all.find(i => i.invoice_number === "RELAYER-SIM-001");
}
if (!invoice) throw new Error("Local invoice creation failed");
if (invoice.status === "Created") {
  await call(await role("ATTESTER"), e.CORE_CONTRACT_ID, "record_verification", { id: invoice.id, v: { verdict: "pass", model_id: "local-simulator", request_hash: "b".repeat(64), response_hash: "c".repeat(64), signature: "", signing_address: "", signing_algo: "", chat_id: "local-simulator", at: "0", signature_checked_on_chain: false } });
  invoice = await view(e.CORE_CONTRACT_ID, "get_invoice", { id: invoice.id });
}
if (invoice.status === "Verified") {
  await call(await role("GUIDED_BUYER"), e.CORE_CONTRACT_ID, "accept_invoice", { id: invoice.id, terms_hash: invoice.terms_hash }, 1n);
  invoice = await view(e.CORE_CONTRACT_ID, "get_invoice", { id: invoice.id });
}
const { buildRepayQuote, OneClickClient, ORIGIN_ASSETS } = await import("../packages/core/src/index.ts");
const { openAutomationStore } = await import("../packages/core/src/automation-store.ts");
const { relayerForward } = await import("../apps/worker/src/relayer.ts");
const s = openAutomationStore(e.DATABASE_PATH), fake = await startFakeOneClick({ port: 0, polls: 3 });
try {
  s.db.exec(`CREATE TABLE IF NOT EXISTS payment_intents (pid TEXT PRIMARY KEY, payment_ref TEXT NOT NULL UNIQUE, network TEXT NOT NULL, invoice_id TEXT NOT NULL, origin_asset TEXT NOT NULL, amount_out_e6 TEXT NOT NULL, amount_in TEXT NOT NULL, deposit_address TEXT NOT NULL, deposit_memo TEXT, refund_to TEXT NOT NULL, deadline TEXT NOT NULL, path TEXT NOT NULL, oneclick_status TEXT NOT NULL, origin_tx TEXT, near_tx TEXT, settled_tx TEXT, quote_json TEXT NOT NULL, created_at INTEGER NOT NULL)`);
  const pid = `local-relayer-${e.CORE_CONTRACT_ID}-${invoice.id}`;
  const before = { payments: invoice.payments, poolIdle: (await view(e.CORE_CONTRACT_ID, "get_pool")).idle };
  if (!invoice.payments.some(p => p.payment_ref === pid)) {
    if (!["Accepted", "Funded", "PartiallyPaid", "Defaulted"].includes(invoice.status)) throw new Error("Invoice not payable");
    const outstanding = BigInt(invoice.face) - (BigInt(invoice.paid.total) - BigInt(invoice.paid.overpaid));
    const config = await view(e.CORE_CONTRACT_ID, "get_config");
    const client = new OneClickClient(fake.baseUrl);
    const quote = await client.quote(buildRepayQuote({ invoiceId: invoice.id, outstandingUnits: outstanding, amountUnits: outstanding, minPayment: config.min_payment, originAsset: ORIGIN_ASSETS.Base.assetId, refundTo: `0x${"1".repeat(40)}`, recipient: e.CORE_CONTRACT_ID, paymentRef: pid, path: "B", relayer: relayerId, dry: false }));
    s.db.prepare(`INSERT INTO payment_intents (pid,payment_ref,network,invoice_id,origin_asset,amount_out_e6,amount_in,deposit_address,refund_to,deadline,path,oneclick_status,quote_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'B','PENDING_DEPOSIT',?,?) ON CONFLICT(pid) DO UPDATE SET deposit_address=excluded.deposit_address, quote_json=excluded.quote_json`).run(pid, pid, net, invoice.id, quote.quoteRequest.originAsset, quote.quote.amountOut, quote.quote.amountIn, quote.quote.depositAddress, quote.quoteRequest.refundTo, quote.quote.deadline, JSON.stringify(quote), Date.now());
    // Fake SUCCESS reports delivery only; mint local tUSDC instead of moving real origin funds.
    const balance = BigInt(await view(e.USDC_CONTRACT_ID, "ft_balance_of", { account_id: relayerId }));
    if (balance < outstanding) await call(root, e.USDC_CONTRACT_ID, "mint", { account_id: relayerId, amount: String(outstanding - balance) }, BigInt(utils.format.parseNearAmount("0.01")));
    for (let n = 0; n < 12; n++) {
      await relayerForward(s, { env: { ...e, SETTLEMENT_PATH: "B", ONECLICK_BASE_URL: fake.baseUrl, ONECLICK_SIMULATOR: "1" } });
      if (s.db.prepare("SELECT state FROM relayer_forwards WHERE pid=?").get(pid)?.state === "confirmed") break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  const afterInvoice = await view(e.CORE_CONTRACT_ID, "get_invoice", { id: invoice.id });
  const matches = afterInvoice.payments.filter(p => p.payment_ref === pid);
  if (matches.length !== 1) throw new Error("Expected exactly one on-chain simulator payment; inspect relayer_forwards manually");
  console.log(JSON.stringify({ label: "Simulated 1Click (local) · Trusted settlement relayer", invoice: invoice.id, pid, before, after: { payments: afterInvoice.payments, poolIdle: (await view(e.CORE_CONTRACT_ID, "get_pool")).idle }, forward: s.db.prepare("SELECT * FROM relayer_forwards WHERE pid=?").get(pid), idempotent: true }, null, 2));
} finally { s.db.close(); await fake.close(); }
