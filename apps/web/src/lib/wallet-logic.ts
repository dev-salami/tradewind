import type { Invoice } from "@tradewind/core";
export function redirectHashes(url: string): string[] {
  const raw = new URL(url).searchParams.get("transactionHashes") || "";
  return [...new Set(raw.split(",").filter(hash => /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(hash)))];
}
export interface TxOutcome {
  transaction?: { hash?: string; signer_id?: string; receiver_id?: string; actions?: { FunctionCall?: { method_name?: string; args?: string } }[] };
  status?: { Failure?: unknown; SuccessValue?: string };
  transaction_outcome?: { outcome: { logs?: string[]; status?: { Failure?: unknown } } };
  receipts_outcome?: { outcome: { logs?: string[]; status?: { Failure?: unknown } } }[];
}
export function invoiceCreatedId(result: TxOutcome): string | undefined {
  const logs = [result.transaction_outcome, ...(result.receipts_outcome || [])].flatMap(r => r?.outcome.logs || []);
  for (const log of logs) {
    if (!log.startsWith("EVENT_JSON:")) continue;
    try {
      const event = JSON.parse(log.slice(11));
      if (event.standard !== "tradewind" || event.event !== "invoice_created") continue;
      const entries = Array.isArray(event.data) ? event.data : [event.data];
      const id = entries.find((d: { invoice_id?: string }) => /^TW-\d+$/.test(d?.invoice_id || ""))?.invoice_id;
      if (id) return id;
    } catch { /* Unrelated or malformed log. */ }
  }
}
export function txFailed(result: TxOutcome): boolean {
  return !!result.status?.Failure || [result.transaction_outcome, ...(result.receipts_outcome || [])].some(r => !!r?.outcome.status?.Failure);
}
export const isOwner = (account: string | null, owner?: string) => !!account && !!owner && account === owner;
export function newestMatchingInvoice(invoices: Invoice[], docHash: string, exclude: string[] = []): Invoice | undefined {
  return invoices.filter(i => i.doc_hash === docHash && !exclude.includes(i.id)).sort((a, b) => BigInt(a.created_at) === BigInt(b.created_at) ? 0 : BigInt(a.created_at) > BigInt(b.created_at) ? -1 : 1)[0];
}
