import { notFound } from "next/navigation";
import { formatUsd } from "@tradewind/core";
import { data } from "@/lib/data";
import { Card } from "@/components/surfaces";
import { ChainRing } from "@/components/chain-ring";
import { DirectPayment } from "@/components/invoice-flows";
export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [invoice, config] = await Promise.all([data().getInvoice(id), data().getConfig()]);
  if (!invoice) notFound();
  const outstanding = BigInt(invoice.face) - BigInt(invoice.paid.total) + BigInt(invoice.paid.overpaid);
  return <div className="tw-mobile-page tw-stack"><header><p className="tw-eyebrow">Pay invoice · {invoice.id}</p><h1>From your chain.<br />Straight to the invoice.</h1></header><Card title={invoice.buyer_label}><p className="tw-muted">Outstanding amount</p><strong className="tw-advance-amount tw-money">{formatUsd(outstanding)}</strong><p>USDC on NEAR</p></Card><Card title="Choose your chain"><ChainRing /><DirectPayment invoice={invoice} minPayment={config.min_payment} /></Card></div>;
}
