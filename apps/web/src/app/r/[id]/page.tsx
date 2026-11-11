import { notFound } from "next/navigation";
import { explorerAccount, formatUsd } from "@tradewind/core";
import { data, isFixtureMode, network } from "@/lib/data";
import { AiProof, Timeline, PaymentList } from "@/components/invoice-panels";
import { Card, Pill } from "@/components/surfaces";
import { WorkerReceipts } from "@/components/worker-receipts";
import { store } from "@/server/db";
import { withWorkerTransactions } from "@/server/receipt-transactions";
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await data().getInvoice(id);
  if (!invoice) notFound();
  const txs = isFixtureMode() ? [] : withWorkerTransactions(id, store().txsForInvoice(id));
  const accountUrl = explorerAccount(network(), invoice.exporter);
  return <div className="tw-stack"><header className="tw-page-head"><div><p className="tw-eyebrow">Public receipt · {invoice.id}</p><h1>Every payment. Every split.</h1><p className="tw-muted">{invoice.buyer_label} · {formatUsd(invoice.face)} {invoice.currency}</p></div><Pill value={isFixtureMode() ? "Sample receipt · no real transactions" : "On-chain view"} tone="slate" /></header>
    <Card title="Receipt source"><p className="tw-muted">All amounts are read from the selected datasource. Per-payment splits are reconstructed with the contract’s locked terms and integer waterfall rules.</p>{accountUrl && <a href={accountUrl} target="_blank" rel="noreferrer" className="tw-text-link">Exporter account on NearBlocks ↗</a>}<p className="tw-muted tw-small">Transaction hashes come from wallet notifications, attester and guided runs recorded by this deployment, plus worker receipts. The history may be incomplete; no hashes are invented.</p></Card>
    <div className="tw-row-2"><Timeline invoice={invoice} txs={txs} /><AiProof invoice={invoice} sample={isFixtureMode()} verify /></div><PaymentList invoice={invoice} txs={txs} />
    <WorkerReceipts id={invoice.id} txs={txs} />
  </div>;
}
