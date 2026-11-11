import { advanceSent, buyerAccepted, buyerReminder, checked, checkFailed, defaulted, explorerTx, invoiceTransitions, keeperActions, lpSharePrice, overdue, paymentReceived, paymentSplits, reminderSent, reminderSteps, repaid, type BuyerRecord, type Config, type Invoice, type Pool, type TelegramCard } from "@tradewind/core";
import type { AutomationStore } from "@tradewind/core/automation-store";
import { makeApproveCard, type ApprovalDependencies } from "../../web/src/server/telegram/callbacks";
import type { GuidedSession } from "../../web/src/server/guided/session-store";
import { guidedCleanupCall } from "./guided-near";
export const log = (job: string, status: string, fields: Record<string, string | number> = {}) => console.log(JSON.stringify({ time: Date.now(), job, status, ...fields }));
export interface JobDependencies extends ApprovalDependencies {
  list(from: number): Promise<Invoice[]>; pool(): Promise<Pool>; config(): Promise<Config>;
  keeper(method: string, id: string): Promise<string>; keeperConfigured: boolean; sample?: boolean;
}
const labelled = (d: JobDependencies, card: TelegramCard): TelegramCard => d.sample ? { ...card, text: `<b>Sample notification · fixture data</b>\n\n${card.text}` } : card;
export async function indexer(s: AutomationStore, d: JobDependencies, now: string) {
  mergeTxLog(s);
  const all: Invoice[] = [];
  for (let from = 0; ; from += 50) { const batch = await d.list(from); all.push(...batch); if (batch.length < 50) break; }
  const config = await d.config();
  for (const i of all) {
    try {
      const cached = s.db.prepare("SELECT json_snapshot FROM invoices_cache WHERE id=?").get(i.id);
      const old = cached ? JSON.parse(String(cached.json_snapshot)) as Invoice : null;
      if (JSON.stringify(old) === JSON.stringify(i)) continue;
      const previousBuyer = s.db.prepare("SELECT json_snapshot FROM buyer_records_cache WHERE account=?").get(i.buyer);
      const beforeRecord = previousBuyer ? JSON.parse(String(previousBuyer.json_snapshot)) as BuyerRecord | null : null;
      const record = await d.buyer(i.buyer);
      const events = invoiceTransitions(old, i);
      const cards: { kind: string; card: TelegramCard; buyer?: boolean }[] = [];
      for (const kind of events) {
        let card: TelegramCard;
        switch (kind) {
          case "checked": card = checked(i, d.base); break;
          case "check_failed": {
            let reasons = ["Invoice check did not pass. Open the invoice for verification details."];
            if (s.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='verifications'").get()) {
              const row = s.db.prepare("SELECT verdict_json FROM verifications WHERE invoice_id=?").get(i.id);
              const saved = row ? JSON.parse(String(row.verdict_json)) : null;
              if (Array.isArray(saved?.reasons) && saved.reasons.length) reasons = saved.reasons.filter((r: unknown): r is string => typeof r === "string");
            }
            card = checkFailed(i, reasons, d.base); break;
          }
          case "accepted": card = buyerAccepted(i, d.base); cards.push({ kind: "advance_ready", card: await makeApproveCard(s, d, i) }); break;
          case "funded": {
            const row = s.db.prepare("SELECT tx_hash FROM automation_receipts WHERE invoice_id=? AND detail='Telegram advance approval' ORDER BY rowid DESC LIMIT 1").get(i.id);
            card = advanceSent(i, d.base, row ? explorerTx(d.network, String(row.tx_hash)) ?? undefined : undefined); break;
          }
          case "payment_received": {
            const parts = paymentSplits(i);
            for (let index = old?.payments.length ?? 0; index < parts.length; index++) {
              const { payment, split } = parts[index];
              cards.push({ kind: `payment_received:${index + 1}`, card: paymentReceived(i, { ...split, total: payment.amount }, payment.amount, index + 1, parts.length, "NEAR settlement", d.base) });
            }
            continue;
          }
          case "repaid": card = repaid(i, beforeRecord?.score ?? record?.score ?? 0, record?.score ?? 0, record?.rate_bps ?? 0, d.base); break;
          case "overdue": {
            const days = Math.max(1, Number((BigInt(now) - BigInt(i.due_at!)) / (BigInt(config.seconds_per_day) * 1_000_000_000n)));
            card = overdue(i, days, d.base); cards.push({ kind, card, buyer: true }); break;
          }
          case "defaulted": card = defaulted(i, (BigInt(i.advance?.amount ?? "0") - BigInt(i.paid.to_pool_principal)).toString(), d.base); break;
          default: throw new Error("Unknown invoice event");
        }
        cards.push({ kind, card });
      }
      s.transaction(() => {
        for (const { kind, card, buyer } of cards) s.enqueue(buyer ? i.buyer : i.exporter, kind, labelled(d, card), `${i.id}:${kind}:${i.status}:${i.paid.total}:${i.overdue}:${buyer ? "buyer" : "exporter"}`, buyer ? "buyer" : "exporter");
        s.db.prepare("INSERT OR REPLACE INTO invoices_cache VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(i.id, d.network, i.exporter, i.buyer, i.face, i.status, i.due_at, JSON.stringify(i), now);
        // Buyer cache is updated after the full invoice batch, so simultaneous events retain the previous score.
      });
    } catch { log("indexer_invoice", "failed", { invoice_id: i.id }); }
  }
  for (const account of new Set(all.map(i => i.buyer))) {
    const record = await d.buyer(account);
    s.db.prepare("INSERT OR REPLACE INTO buyer_records_cache VALUES (?, ?)").run(account, JSON.stringify(record));
  }
  const pool = await d.pool(), json = JSON.stringify(pool);
  const previous = s.db.prepare("SELECT json_snapshot, share_price_e6 FROM pool_snapshots ORDER BY block DESC LIMIT 1").get();
  if (!previous || previous.json_snapshot !== json) s.transaction(() => {
    // 'block' is a monotonic local snapshot key, not a claimed RPC block height.
    s.db.prepare("INSERT INTO pool_snapshots (ts, idle, outstanding, written_off, total_shares, share_price_e6, json_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)").run(now, pool.idle, pool.outstanding_principal, pool.written_off, pool.total_shares, pool.share_price_e6, json);
    if (previous && previous.share_price_e6 !== pool.share_price_e6) {
      const links = s.db.prepare("SELECT near_account FROM telegram_links WHERE role='lp'").all();
      for (const l of links) s.enqueue(String(l.near_account), "share_price", labelled(d, lpSharePrice(String(previous.share_price_e6), pool.share_price_e6, d.base)), `pool:${now}:${l.near_account}`, "lp");
    }
  });
  mergeTxLog(s);
  return { invoices: all, config };
}
export function mergeTxLog(s: AutomationStore) {
  if (!s.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tx_log'").get()) return; // TODO: tx/notify lands in the wallet worktree.
  const columns = s.db.prepare("PRAGMA table_info(tx_log)").all().map(r => String(r.name));
  if (!columns.includes("invoice_id") || !columns.includes("tx_hash")) return; // TODO: reconcile a different tx_log schema without guessing hashes.
  s.db.exec("INSERT OR IGNORE INTO automation_receipts (invoice_id, tx_hash, detail) SELECT invoice_id, tx_hash, 'wallet tx notify' FROM tx_log WHERE invoice_id IS NOT NULL AND tx_hash IS NOT NULL");
}
export async function keeper(s: AutomationStore, d: JobDependencies, invoices: Invoice[], now: string, config: Config) {
  if (!d.keeperConfigured) { log("keeper", "skipped_not_configured"); return; }
  for (const action of keeperActions(invoices, now, config)) {
    try { const tx = await d.keeper(action.method, action.id); s.db.prepare("INSERT OR IGNORE INTO automation_receipts VALUES (?, ?, ?)").run(action.id, tx, action.method); log("keeper", "sent", { invoice_id: action.id, tx_hash: tx }); }
    catch { log("keeper", "failed", { invoice_id: action.id }); }
  }
}
export function guidedCleanupDecision(invoice: Invoice, createdAt: number, now: number, staleMinutes = 10): "cancel" | "repay" | null {
  if (now - createdAt < staleMinutes * 60_000) return null;
  if (!invoice.advance && ["Created", "Verified", "Accepted"].includes(invoice.status)) return "cancel";
  if (invoice.advance && ["Funded", "PartiallyPaid", "Defaulted"].includes(invoice.status) && BigInt(invoice.face) > BigInt(invoice.paid.total) - BigInt(invoice.paid.overpaid)) return "repay";
  return null;
}
// Returns protected IDs even after an RPC failure, so the keeper never defaults demo buyers.
export async function guidedCleanup(s: AutomationStore, d: JobDependencies, invoices: Invoice[], now = Date.now(), send = guidedCleanupCall): Promise<Set<string>> {
  const protectedIds = new Set<string>();
  if (process.env.NEAR_NETWORK === "mainnet" || d.network === "mainnet" || d.sample) return protectedIds;
  if (!s.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='guided_sessions'").get()) return protectedIds;
  const minutes = Number(process.env.GUIDED_STALE_MINUTES || 10);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("Invalid GUIDED_STALE_MINUTES");
  const sessions = s.db.prepare("SELECT * FROM guided_sessions").all() as unknown as GuidedSession[];
  for (const invoice of invoices) {
    const session = sessions.find(row => row.buyer_account === invoice.buyer);
    if (!session || invoice.exporter !== process.env.GUIDED_EXPORTER_ACCOUNT_ID) continue;
    protectedIds.add(invoice.id);
    if (process.env.GUIDED_ENABLED !== "1") continue; // Disabling signing must not expose abandoned sessions to keeper defaulting.
    const action = guidedCleanupDecision(invoice, Number(BigInt(invoice.created_at) / 1_000_000n), now, minutes);
    if (!action) continue;
    try {
      const hash = await send(action, invoice, session);
      s.db.prepare("INSERT OR IGNORE INTO automation_receipts VALUES (?, ?, ?)").run(invoice.id, hash, `guided_${action}`);
      log("guidedCleanup", action, { invoice_id: invoice.id, tx_hash: hash });
    } catch (error) {
      const missing = action === "cancel" && /MethodNotFound|method.*(not found|does not exist)|cannot find.*method/i.test(String(error));
      log("guidedCleanup", missing ? "cancel_unavailable" : "failed", { invoice_id: invoice.id });
    }
  }
  return protectedIds;
}
export function reminders(s: AutomationStore, d: JobDependencies, invoices: Invoice[], now: string, config: Config) {
  for (const i of invoices) {
    try {
      const sent = new Set(s.db.prepare("SELECT step FROM reminders WHERE invoice_id=?").all(i.id).map(r => String(r.step)));
      for (const step of reminderSteps(i, now, config.seconds_per_day, sent)) s.transaction(() => {
        const channel = s.link(i.buyer, "buyer") ? "telegram" : "log";
        const result = s.db.prepare("INSERT OR IGNORE INTO reminders VALUES (?, ?, ?, ?)").run(i.id, step, channel, Date.now());
        if (!result.changes) return;
        const dueLabel = new Date(Number(BigInt(i.due_at!) / 1_000_000n)).toISOString();
        const contractDay = ((BigInt(i.due_at!) - BigInt(i.accepted_at!)) / (BigInt(config.seconds_per_day) * 1_000_000_000n)).toString();
        s.enqueue(i.buyer, "buyer_reminder", labelled(d, buyerReminder(i, step, d.base, dueLabel, contractDay)), `${i.id}:reminder:${step}:buyer`, "buyer");
        s.enqueue(i.exporter, "reminder_sent", labelled(d, reminderSent(i, step, d.base)), `${i.id}:reminder:${step}:exporter`);
        log("reminder", channel, { invoice_id: i.id, step });
      });
    } catch { log("reminders", "failed", { invoice_id: i.id }); }
  }
}
