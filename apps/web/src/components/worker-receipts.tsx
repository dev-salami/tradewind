import { explorerTx } from "@tradewind/core";
import { network, isFixtureMode } from "@/lib/data";
import { telegramStore } from "@/server/telegram/store";
export function WorkerReceipts({ id }: { id: string }) {
  if (isFixtureMode()) return null;
  const s = telegramStore();
  const txs = s.db.prepare("SELECT tx_hash FROM automation_receipts WHERE invoice_id=?").all(id);
  const reminders = s.db.prepare("SELECT step, channel, sent_at FROM reminders WHERE invoice_id=? ORDER BY sent_at").all(id);
  return <section className="tw-card tw-stack"><h2>Indexed transactions & reminders</h2>{txs.map(row => { const hash = String(row.tx_hash), url = explorerTx(network(), hash); return url ? <a className="tw-text-link tw-break" key={hash} href={url} rel="noreferrer" target="_blank">Transaction {hash} ↗</a> : <code key={hash}>{hash}</code>; })}{reminders.map(row => <p key={String(row.step)}>{String(row.step)} · {String(row.channel)} · {new Date(Number(row.sent_at)).toISOString()}</p>)}{!txs.length && !reminders.length && <p className="tw-muted">No indexed transactions or reminders yet.</p>}</section>;
}
