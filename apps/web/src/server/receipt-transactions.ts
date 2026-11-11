import "server-only";
import type { ReceiptTx } from "@/lib/receipt-txs";
import { telegramStore } from "./telegram/store";

// Worker receipts have no timestamp or payment key. Preserve their details and
// only classify the exact advance receipt emitted by this deployment.
export function withWorkerTransactions(id: string, txs: readonly ReceiptTx[]): ReceiptTx[] {
  const known = new Map(txs.filter(tx => tx.tx_hash).map(tx => [tx.tx_hash, tx]));
  const rows = telegramStore().db.prepare("SELECT tx_hash, detail FROM automation_receipts WHERE invoice_id=? ORDER BY rowid").all(id);
  for (const row of rows) {
    const hash = String(row.tx_hash), detail = String(row.detail);
    const advance = detail === "Telegram advance approval";
    const existing = known.get(hash);
    const method = advance ? "request_advance" : detail.startsWith("mark_") ? detail : null;
    known.set(hash, { tx_hash: hash, method: existing?.method ?? method, kind: existing?.kind ?? (advance ? "advance" : "other"), detail });
  }
  return [...known.values()];
}
