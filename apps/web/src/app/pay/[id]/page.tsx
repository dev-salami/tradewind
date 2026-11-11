import { notFound } from "next/navigation";
import { formatUsd } from "@tradewind/core";
import { data, isFixtureMode } from "@/lib/data";
import { Card } from "@/components/surfaces";
import { AnyChainPayment } from "@/components/any-chain-payment";
import { liveQuotesAllowed } from "@/server/pay";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function PayPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ part?: string }> }) {
  const { id } = await params;
  const [invoice, config] = await Promise.all([data().getInvoice(id), data().getConfig()]);
  if (!invoice) notFound();
  const outstanding = BigInt(invoice.face) - BigInt(invoice.paid.total) + BigInt(invoice.paid.overpaid);
  return <div className="tw-mobile-page tw-stack"><header><p className="tw-eyebrow">Pay invoice · {invoice.id}</p><h1>From your chain.<br />Straight to the invoice.</h1></header><Card title={invoice.buyer_label}><p className="tw-muted">Outstanding amount</p><strong className="tw-advance-amount tw-money">{formatUsd(outstanding)}</strong><p>USDC on NEAR</p></Card><Card title="Choose your chain"><AnyChainPayment invoice={invoice} minPayment={config.min_payment} liveAllowed={liveQuotesAllowed() && !isFixtureMode()} preview={env().NEAR_NETWORK !== "mainnet"} initialPart={(await searchParams).part === "1"} /></Card></div>;
}
