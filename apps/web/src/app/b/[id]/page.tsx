import { notFound } from "next/navigation";
import Link from "next/link";
import { dueInText, formatNs, formatUsd } from "@tradewind/core";
import { data, isFixtureMode, nowNs } from "@/lib/data";
import { Card, Pill } from "@/components/surfaces";
import { AiProof, ShortHash } from "@/components/invoice-panels";
export default async function BuyerReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = data();
  const [invoice, config] = await Promise.all([source.getInvoice(id), source.getConfig()]);
  if (!invoice) notFound();
  return <div className="tw-mobile-page tw-stack"><header><p className="tw-eyebrow">Buyer review · {invoice.id}</p><h1>Review your invoice</h1><p className="tw-muted">{invoice.buyer_label}{isFixtureMode() && " · team test wallet"}</p></header>
    <Card title={`Invoice ${invoice.invoice_number}`}><p className="tw-eyebrow">{isFixtureMode() ? "SAMPLE invoice" : invoice.exporter}</p><strong className="tw-advance-amount tw-money">{formatUsd(invoice.face)}</strong><p>{invoice.currency} · Net {invoice.tenor_days}</p>
      <dl className="tw-details"><div><dt>Exporter</dt><dd>{invoice.exporter}</dd></div><div><dt>Buyer account</dt><dd>{invoice.buyer}</dd></div><div><dt>Due</dt><dd>{dueInText(nowNs(), invoice.due_at, config.seconds_per_day)}</dd></div><div><dt>Due timestamp</dt><dd>{invoice.due_at ? formatNs(invoice.due_at, { originNs: invoice.accepted_at ?? invoice.created_at, secondsPerDay: config.seconds_per_day }) : "Set on acceptance"}</dd></div><div><dt>Terms hash</dt><dd><ShortHash value={invoice.terms_hash} /></dd></div></dl>
      {invoice.accepted_at && <Pill value="Accepted · signed by buyer" tone="green" />}<button className="tw-button tw-full" disabled>Accept invoice</button><p className="tw-muted tw-small">Connect the named buyer’s NEAR wallet to accept these exact terms. Available after wallet connect.</p>
    </Card><AiProof invoice={invoice} sample={isFixtureMode()} /><Card title="Stay up to date"><Pill value="Telegram not linked" /><p className="tw-muted tw-small">Payment reminders are available after wallet connect.</p><Link className="tw-text-link" href={`/pay/${id}`}>Open payment page ↗</Link></Card>
  </div>;
}
