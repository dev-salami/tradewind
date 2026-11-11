import "server-only";
import { EVENT_RECEIPT_LABELS, type ReceiptTx } from "@/lib/receipt-txs";
import { receiptExplorer } from "@/lib/tx";
import { network } from "@/lib/env-public";
import type { DatabaseSync } from "node:sqlite";
import { telegramStore } from "./telegram/store";

// Worker receipts have no timestamp or payment key. Preserve their details and
// only classify the exact advance receipt emitted by this deployment.
export function withWorkerTransactions(id: string, txs: readonly ReceiptTx[]): ReceiptTx[] {
  return resolveReceiptTransactions(telegramStore().db, id, txs, network());
}
export function resolveReceiptTransactions(db: DatabaseSync, id: string, txs: readonly ReceiptTx[], net: Parameters<typeof receiptExplorer>[0]): ReceiptTx[] {
  const known = new Map(txs.filter(tx => tx.tx_hash).map(tx => [tx.tx_hash, tx]));
  const exists = (name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const rows = exists("automation_receipts") ? db.prepare("SELECT tx_hash, detail FROM automation_receipts WHERE invoice_id=? ORDER BY rowid").all(id) : [];
  for (const row of rows) {
    const hash = String(row.tx_hash), detail = String(row.detail);
    const advance = detail === "Telegram advance approval";
    const existing = known.get(hash);
    const method = advance ? "request_advance" : detail.startsWith("mark_") ? detail : null;
    known.set(hash, { tx_hash: hash, method: existing?.method ?? method, kind: existing?.kind ?? (advance ? "advance" : "other"), detail });
  }
  if (exists("chain_events")) {
    const labels = new Map<string, string[]>();
    for (const row of db.prepare("SELECT tx_hash, event FROM chain_events WHERE invoice_id=? ORDER BY block_height, receipt_id, idx").all(id)) {
      const mapped = EVENT_RECEIPT_LABELS[String(row.event)];
      if (!mapped) continue;
      const hash = String(row.tx_hash), previous = labels.get(hash) ?? [];
      if (!previous.includes(mapped.label)) previous.push(mapped.label);
      labels.set(hash, previous);
      const existing = known.get(hash);
      const method = row.event === "invoice_defaulted" ? "mark_default" : String(row.event);
      known.set(hash, { tx_hash: hash, method: existing?.method ?? method, kind: previous.length === 1 ? mapped.kind : existing?.kind ?? mapped.kind, detail: previous.join(" · ") });
    }
  }
  if (net === "sandbox") for (const [hash, tx] of known) known.set(hash, { ...tx, detail: [tx.detail, receiptExplorer(net, hash).label].filter(Boolean).join(" · ") });
  return [...known.values()];
}
