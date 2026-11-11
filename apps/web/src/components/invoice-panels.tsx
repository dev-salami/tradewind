import Link from "next/link";
import { BadgeCheck, FileCheck2, ShieldCheck } from "lucide-react";
import { formatUsd, paymentSplits, type Invoice, type NearNetwork, explorerAccount } from "@tradewind/core";
import { Card, Pill } from "./surfaces";
import { StatusChip } from "./status-chip";
import { WaterfallBars } from "./waterfall";
export function ShortHash({ value }: { value: string }) { return <code className="tw-hash" title={value}>{value.length > 18 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value}</code>; }
export function AiProof({ invoice, sample, verify = false }: { invoice: Invoice; sample: boolean; verify?: boolean }) {
  const v = invoice.verification;
  return <Card title="AI document check" action={<ShieldCheck size={20} />}>
    {!v ? <p className="tw-muted">No AI check recorded yet.</p> : <div className="tw-stack">
      <div className="tw-ai-badge"><BadgeCheck size={21} aria-hidden="true" />Checked by NEAR AI · private (TEE)</div>
      {sample && <p className="tw-sample-note">Sample attestation · illustrative only, not a valid TEE proof.</p>}
      <Pill value={`Verdict: ${v.verdict}`} tone={v.verdict === "pass" ? "green" : "coral"} />
      <dl className="tw-details"><div><dt>Model</dt><dd>{v.model_id}</dd></div><div><dt>Signature</dt><dd><ShortHash value={v.signature} /></dd></div>
        <div><dt>Document</dt><dd><FileCheck2 size={14} /> doc hash stored <ShortHash value={invoice.doc_hash} /></dd></div>
        <div><dt>Request hash</dt><dd><ShortHash value={v.request_hash} /></dd></div><div><dt>Response hash</dt><dd><ShortHash value={v.response_hash} /></dd></div>
        <div><dt>Signer</dt><dd><ShortHash value={v.signing_address} /></dd></div><div><dt>Algorithm / chat</dt><dd>{v.signing_algo} · {v.chat_id}</dd></div>
      </dl>
      {verify && <div><button className="tw-button" disabled>Verify</button><p className="tw-muted tw-small">Independent signature verification is wired in a later step.</p></div>}
      <p className="tw-muted tw-small">AI checks consistency, not real-world authenticity. Documents are private during the AI check; amounts and buyer accounts are public on-chain.</p>
    </div>}
  </Card>;
}
export function TokenCard({ invoice, holder, network }: { invoice: Invoice; holder: string; network: NearNetwork }) {
  const url = explorerAccount(network, holder.replace(" (sample)", ""));
  return <Card className="tw-token" title={`Invoice ${invoice.id} — on-chain asset`} action={<img src="/brand/tradewind-app-icon.svg" alt="" width="42" height="42" />}>
    <p className="tw-eyebrow">{invoice.accepted_at ? "NEAR · Invoice NFT" : "Not minted · awaiting acceptance"}</p>
    <strong className="tw-token-amount tw-money">{formatUsd(invoice.face)} <small>{invoice.currency}</small></strong>
    <p>{invoice.buyer_label} · Net {invoice.tenor_days}</p><StatusChip status={invoice.status} overdue={invoice.overdue} />
    <div className="tw-token-bottom"><span>Holder</span><span>{invoice.accepted_at ? holder : "Not minted"}</span></div>
    {url && invoice.accepted_at && <a href={url} target="_blank" rel="noreferrer" className="tw-muted">View holder on NearBlocks ↗</a>}
    <div className="tw-hatch" aria-hidden="true" />
  </Card>;
}
export function Timeline({ invoice }: { invoice: Invoice }) {
  const steps = [
    { name: "Created", at: invoice.created_at }, { name: "Checked", at: invoice.verification?.at },
    { name: "Accepted", at: invoice.accepted_at }, { name: "Funded", at: invoice.advance?.at },
    ...invoice.payments.map((p, index) => ({ name: `Paid part ${index + 1}`, at: p.at })),
    { name: "Repaid", at: invoice.status === "Repaid" ? invoice.payments.at(-1)?.at : null },
  ];
  return <Card title="On-chain timeline"><ol className="tw-timeline">{steps.map(step => <li key={step.name} className={step.at ? "tw-complete" : ""}><span className="tw-timeline-dot" /><div><strong>{step.name}</strong><p className="tw-muted">{step.at ? `${step.at} ns` : "Not yet recorded"}</p><small>{step.at ? "Transaction link unavailable · event indexer pending" : "Transaction link pending"}</small></div></li>)}</ol></Card>;
}
export function PaymentList({ invoice }: { invoice: Invoice }) {
  const splits = paymentSplits(invoice);
  const settled = BigInt(invoice.paid.total) - BigInt(invoice.paid.overpaid);
  const percentage = BigInt(invoice.face) ? Number(settled * 10_000n / BigInt(invoice.face)) / 100 : 0;
  return <Card title="Payments & waterfall" action={<Link className="tw-ghost" href={`/pay/${invoice.id}`}>Pay invoice ↗</Link>}>
    <div className="tw-stack"><p className="tw-money">{formatUsd(settled)} of {formatUsd(invoice.face)} paid</p><div className="tw-progress" role="progressbar" aria-label="Invoice repaid" aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percentage}%` }} /></div>
      {!splits.length && <p className="tw-muted">No payments yet. The pool is repaid first, then protocol, then exporter.</p>}
      {splits.map(({ payment, split }, index) => <article className="tw-payment" key={payment.payment_ref + index}><div className="tw-card-head"><h3>Part {index + 1} · <span className="tw-money">{formatUsd(payment.amount)}</span></h3><Pill value="Money in" tone="green" /></div><p className="tw-muted tw-break">{payment.sender} · {payment.payment_ref}</p><p className="tw-muted tw-small">Recorded at {payment.at} ns</p><WaterfallBars split={split} /></article>)}
    </div>
  </Card>;
}
