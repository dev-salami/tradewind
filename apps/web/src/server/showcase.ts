import "server-only";
import { data, isFixtureMode } from "@/lib/data";
import type { TradewindData } from "@tradewind/core";

export interface Showcase { invoiceId: string; buyer: string }
export async function resolveShowcase(source: Pick<TradewindData, "getInvoice" | "listInvoices" | "getBuyerRecord">, configured = { invoiceId: process.env.SHOWCASE_INVOICE_ID, buyer: process.env.SHOWCASE_BUYER }): Promise<Showcase | null> {
  try {
    if (configured.invoiceId) {
      const invoice = await source.getInvoice(configured.invoiceId);
      if (invoice && (!configured.buyer || configured.buyer === invoice.buyer) && await source.getBuyerRecord(invoice.buyer)) return { invoiceId: invoice.id, buyer: invoice.buyer };
    }
  } catch { /* Invalid/stale overrides fall through to chain discovery. */ }
  try {
    let latest: Awaited<ReturnType<TradewindData["getInvoice"]>> = null;
    for (let from = 0; ; from += 50) {
      const batch = await source.listInvoices(from, 50);
      for (const invoice of batch) if (invoice.status === "Repaid" && (!latest || BigInt(invoice.created_at) > BigInt(latest.created_at) || (invoice.created_at === latest.created_at && invoice.id > latest.id))) latest = invoice;
      if (batch.length < 50) break;
    }
    return latest ? { invoiceId: latest.id, buyer: latest.buyer } : null;
  } catch { return null; }
}
export async function showcase(): Promise<Showcase | null> {
  if (isFixtureMode()) return { invoiceId: "TW-0042", buyer: "gulf-foods-sample.testnet" };
  try { return await resolveShowcase(data()); } catch { return null; }
}
