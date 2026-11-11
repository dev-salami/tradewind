import { explorerTx } from "@tradewind/core";
import { network, isFixtureMode } from "@/lib/data";
import { telegramStore } from "@/server/telegram/store";
import type { ReceiptTx } from "@/lib/receipt-txs";
import { Card } from "./surfaces";
import { withWorkerTransactions } from "@/server/receipt-transactions";
import { store } from "@/server/db";
export function WorkerReceipts({ id, txs }: { id: string; txs?: readonly ReceiptTx[] }) {
  if (isFixtureMode()) return null;
  const s = telegramStore();
  const known = txs ?? withWorkerTransactions(id, store().txsForInvoice(id));
  const reminders = s.db.prepare("SELECT step, channel, sent_at FROM reminders WHERE invoice_id=? ORDER BY sent_at").all(id);
  return <Card title="Transactions"><div className="tw-stack">{known.map(tx => {
    const url = explorerTx(network(), tx.tx_hash);
    return <p className="tw-break" key={tx.tx_hash}><strong>{tx.kind ?? "other"}</strong>{tx.method && <> · {tx.method}</>}{tx.detail && <> · {tx.detail}</>} · {url ? <a className="tw-text-link" href={url} rel="noreferrer" target="_blank">{tx.tx_hash} ↗</a> : <code>{tx.tx_hash}</code>}</p>;
  })}{!known.length && <p className="tw-muted">No transactions recorded by this deployment yet.</p>}<h3>Reminders</h3>{reminders.map(row => <p key={String(row.step)}>{String(row.step)} · {String(row.channel)} · {new Date(Number(row.sent_at)).toISOString()}</p>)}{!reminders.length && <p className="tw-muted">No reminders recorded yet.</p>}</div></Card>;
}
