import { Account, connect, KeyPair, keyStores } from "near-api-js";
import { getInvoice, OneClickClient, planForward, RELAYER_CONFIRM_TIMEOUT_MS, type ForwardRecord, type Invoice, type QuoteResponse } from "@tradewind/core";
import type { AutomationStore } from "@tradewind/core/automation-store";

export interface RelayerDependencies {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  invoice?: (id: string) => Promise<Invoice | null>;
  forward?: (amount: bigint, invoiceId: string, pid: string) => Promise<string>;
  log?: (event: string) => void;
}
interface IntentRow { pid: string; invoice_id: string; deposit_address: string; deposit_memo: string | null; quote_json: string; path: string }
interface Row extends ForwardRecord { amount_e6: string; tx_hash: string | null; reason: string }

/** Separate RELAYER_ signer. No buyer, keeper, or bot key is ever used. */
export async function forwardPayment(e: NodeJS.ProcessEnv, amount: bigint, invoiceId: string, pid: string) {
  if (e.NEAR_NETWORK === "mainnet" && e.RELAYER_MAINNET_OK !== "1") throw new Error("Trusted settlement relayer refuses mainnet signing");
  if (!e.RELAYER_ACCOUNT_ID || !e.RELAYER_PRIVATE_KEY || !e.CORE_CONTRACT_ID || !e.USDC_CONTRACT_ID || !e.NEAR_RPC_URL) throw new Error("Trusted settlement relayer configuration missing");
  const networkId = e.NEAR_NETWORK || "testnet", keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(networkId, e.RELAYER_ACCOUNT_ID, KeyPair.fromString(e.RELAYER_PRIVATE_KEY as `ed25519:${string}`));
  const near = await connect({ networkId, nodeUrl: e.NEAR_RPC_URL, keyStore });
  const account = new Account(near.connection, e.RELAYER_ACCOUNT_ID);
  const tx = await account.functionCall({ contractId: e.USDC_CONTRACT_ID, methodName: "ft_transfer_call", args: { receiver_id: e.CORE_CONTRACT_ID, amount: amount.toString(), msg: JSON.stringify({ action: "repay", invoice_id: invoiceId, payment_ref: pid }) }, attachedDeposit: 1n, gas: 100_000_000_000_000n });
  if (typeof tx.status === "object" && "Failure" in tx.status) throw new Error("Forward transaction failed; reconcile manually");
  return tx.transaction.hash;
}

export async function relayerForward(s: AutomationStore, deps: RelayerDependencies = {}, now = Date.now()) {
  const e = deps.env ?? process.env, log = deps.log ?? (event => console.log(JSON.stringify({ job: "Trusted settlement relayer", event })));
  if (e.SETTLEMENT_PATH !== "B" || !e.RELAYER_ACCOUNT_ID || !e.RELAYER_PRIVATE_KEY) { log("skipped_not_configured"); return; }
  if (e.NEAR_NETWORK === "mainnet" && e.RELAYER_MAINNET_OK !== "1") { log("skipped_mainnet_refused"); return; }
  if (e.ONECLICK_SIMULATOR === "1" && e.NEAR_NETWORK === "mainnet") { log("skipped_simulator_mainnet_refused"); return; }
  if (e.ONECLICK_SIMULATOR === "1") {
    const url = new URL(e.ONECLICK_BASE_URL || "https://1click.chaindefuser.com");
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) { log("skipped_simulator_nonlocal_refused"); return; }
  }
  const timeout = Number(e.RELAYER_CONFIRM_TIMEOUT_MS || RELAYER_CONFIRM_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error("Invalid RELAYER_CONFIRM_TIMEOUT_MS");
  s.db.exec(`CREATE TABLE IF NOT EXISTS relayer_forwards (
    pid TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, amount_e6 TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('planned','sent','confirmed','held','failed','review')),
    tx_hash TEXT, reason TEXT NOT NULL, updated_at INTEGER NOT NULL)`);
  if (!s.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payment_intents'").get()) { log("skipped_no_intents"); return; }
  const client = new OneClickClient(e.ONECLICK_BASE_URL, e.ONECLICK_JWT, deps.fetch);
  const invoiceView = deps.invoice ?? (id => getInvoice(e.NEAR_RPC_URL || "http://127.0.0.1:3030", e.CORE_CONTRACT_ID || "", id));
  const send = deps.forward ?? ((amount, id, pid) => forwardPayment(e, amount, id, pid));
  const intents = s.db.prepare("SELECT * FROM payment_intents WHERE path='B' AND network=? AND oneclick_status NOT IN ('REFUNDED','FAILED')").all(e.NEAR_NETWORK || "testnet") as unknown as IntentRow[];
  for (const intent of intents) {
    try {
      const [status, invoice] = await Promise.all([client.status(intent.deposit_address, intent.deposit_memo ?? undefined), invoiceView(intent.invoice_id)]);
      const existing = s.db.prepare("SELECT * FROM relayer_forwards WHERE pid=?").get(intent.pid) as unknown as Row | undefined;
      const plan = planForward({ ...intent, quoteResponse: JSON.parse(intent.quote_json) as QuoteResponse, forward: existing, now, confirmTimeoutMs: timeout }, status, invoice, existing && ["sent", "confirmed"].includes(existing.state) ? BigInt(existing.amount_e6) : 0n);
      // Keep polling uncertain sends even if the provider subsequently says FAILED/REFUNDED.
      const pending = existing && ["planned", "sent", "review", "failed"].includes(existing.state) && !invoice?.payments.some(p => p.payment_ref === intent.pid);
      if (!pending || !["REFUNDED", "FAILED"].includes(status.status)) s.db.prepare("UPDATE payment_intents SET oneclick_status=? WHERE pid=?").run(status.status, intent.pid);
      if (invoice?.payments.some(p => p.payment_ref === intent.pid)) {
        s.db.prepare(`INSERT INTO relayer_forwards VALUES (?, ?, ?, 'confirmed', ?, ?, ?) ON CONFLICT(pid) DO UPDATE SET state='confirmed', amount_e6=excluded.amount_e6, reason=excluded.reason, updated_at=excluded.updated_at`).run(intent.pid, intent.invoice_id, invoice.payments.find(p => p.payment_ref === intent.pid)!.amount, existing?.tx_hash ?? null, existing?.reason ?? plan.reason, now);
        s.db.prepare("UPDATE payment_intents SET settled_tx=? WHERE pid=?").run(existing?.tx_hash ?? null, intent.pid);
        continue;
      }
      if (plan.action === "forward") {
        // Durable unique claim BEFORE any asynchronous signing. Other ticks/processes cannot send again.
        const claimed = s.transaction(() => s.db.prepare("INSERT OR IGNORE INTO relayer_forwards VALUES (?, ?, ?, 'planned', NULL, ?, ?)").run(intent.pid, intent.invoice_id, plan.amount!.toString(), plan.reason, now).changes);
        if (!claimed) continue;
        try {
          const hash = await send(plan.amount!, intent.invoice_id, intent.pid);
          s.db.prepare("UPDATE relayer_forwards SET state=CASE WHEN state='planned' THEN 'sent' ELSE state END, tx_hash=?, updated_at=? WHERE pid=?").run(hash, now, intent.pid);
        } catch {
          // An RPC error does not prove the transaction was not broadcast.
          s.db.prepare("UPDATE relayer_forwards SET state='review', reason='Send outcome uncertain; reconcile manually, never auto-resend', updated_at=? WHERE pid=?").run(now, intent.pid);
          log("send_requires_review");
        }
      } else if (plan.action === "hold" || plan.action === "refund_review") {
        s.db.prepare(`INSERT INTO relayer_forwards VALUES (?, ?, '0', ?, NULL, ?, ?) ON CONFLICT(pid) DO UPDATE SET state=excluded.state, reason=excluded.reason, updated_at=excluded.updated_at`).run(intent.pid, intent.invoice_id, plan.action === "hold" ? "held" : "review", plan.reason, now);
      }
    } catch { log("intent_poll_failed"); }
  }
}
