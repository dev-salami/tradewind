import { notFound } from "next/navigation";
import Link from "next/link";
import { formatUsd } from "@tradewind/core";
import { data, isFixtureMode, network, contractHolder } from "@/lib/data";
import { Card, Pill } from "@/components/surfaces";
import { AiProof, Timeline, TokenCard, PaymentList, ShortHash } from "@/components/invoice-panels";
import { AdvanceInvoice, CancelInvoice } from "@/components/invoice-flows";
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = data();
  const invoice = await source.getInvoice(id);
  if (!invoice) notFound();
  const [livePreview, buyer] = await Promise.all([source.previewAdvance(id), source.getBuyerRecord(invoice.buyer)]);
  const preview = invoice.advance ? { ...livePreview, rate_bps: invoice.advance.rate_bps, advance: invoice.advance.amount, pool_fee: invoice.advance.pool_fee, protocol_fee: invoice.advance.protocol_fee, exporter_rest: (BigInt(invoice.face) - BigInt(invoice.advance.amount) - BigInt(invoice.advance.pool_fee) - BigInt(invoice.advance.protocol_fee)).toString() } : livePreview;
  const repaid = buyer ? buyer.repaid_on_time + buyer.repaid_grace + buyer.repaid_late : 0;
  return <div className="tw-stack"><Link href="/app" className="tw-back">← All invoices</Link><header className="tw-page-head"><div><p className="tw-eyebrow">Invoice detail</p><h1>{invoice.id} · {invoice.buyer_label}</h1><p className="tw-muted">{formatUsd(invoice.face)} {invoice.currency} · Net {invoice.tenor_days}</p></div><Link href={`/r/${id}`} className="tw-ghost">Public receipt ↗</Link></header>
    <div className="tw-row-2"><TokenCard invoice={invoice} holder={invoice.advance && invoice.status !== "Repaid" ? contractHolder() : invoice.exporter} network={network()} /><Card title={invoice.advance ? "Locked advance terms" : "Advance preview"} action={<Pill value={`${preview.rate_bps / 100}% rate`} tone="green" />}>
      <p className="tw-muted">{isFixtureMode() ? "Illustrative pricing" : "Contract preview"}</p><strong className="tw-advance-amount tw-money">{formatUsd(preview.advance)}</strong><p>USDC advance to exporter</p>
      <dl className="tw-details"><div><dt>Pool fee</dt><dd className="tw-money">{formatUsd(preview.pool_fee)}</dd></div><div><dt>Protocol fee</dt><dd className="tw-money">{formatUsd(preview.protocol_fee)}</dd></div><div><dt>Exporter rest</dt><dd className="tw-money">{formatUsd(preview.exporter_rest)}</dd></div></dl>
      <p className="tw-record-line">buyer record: {repaid} repaid ({buyer?.repaid_on_time ?? 0} on time) · score {buyer?.score ?? 0}</p>
      <p className={preview.eligible ? "tw-green" : "tw-muted"}>{preview.eligible ? "Eligible for advance" : preview.reason}</p><AdvanceInvoice invoice={invoice} /><CancelInvoice invoice={invoice} />
      <p className="tw-small">Terms <ShortHash value={invoice.terms_hash} /></p>
    </Card></div>
    <div className="tw-row-2"><Timeline invoice={invoice} /><AiProof invoice={invoice} sample={isFixtureMode()} /></div><PaymentList invoice={invoice} />
    <Card title="Buyer & reminders"><div className="tw-toolbar"><Link href={`/b/${id}`} className="tw-ghost">Buyer review ↗</Link><Link href={`/buyer/${invoice.buyer}`} className="tw-ghost">Buyer record ↗</Link></div><p className="tw-muted tw-small">No reminder log connected. Telegram not linked.</p></Card>
  </div>;
}
