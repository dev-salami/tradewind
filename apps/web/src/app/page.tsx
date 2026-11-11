import Link from "next/link";
import { ArrowUpRight, FileCheck2, Fingerprint, Banknote } from "lucide-react";
import { data, network, contractHolder } from "@/lib/data";
import { TokenCard } from "@/components/invoice-panels";
import { showcase } from "@/server/showcase";
export default async function Landing() {
  const sample = await showcase();
  const invoice = sample ? await data().getInvoice(sample.invoiceId).catch(() => null) : null;
  return <div className="tw-landing tw-stack"><section className="tw-hero"><div className="tw-hero-copy"><img src="/brand/tradewind-logo-dark-bg.svg" alt="Tradewind" width="180" height="48" /><p className="tw-eyebrow">Working capital, without the wait</p><h1>Shipped today.<br /><em>Paid in 60 days.</em></h1><p className="tw-hero-sub">Get paid today for invoices your buyers pay in 60 days.</p><div className="tw-hero-actions"><Link href="/app" className="tw-button">Try the testnet sandbox <ArrowUpRight size={18} /></Link><Link href={sample ? `/r/${encodeURIComponent(sample.invoiceId)}` : "/app/guided"} className="tw-hero-secondary">{sample ? "See the sample receipt" : "Play both sides"}</Link></div><p className="tw-hero-note">On NEAR · documents checked privately · settlement from any chain</p></div><div className="tw-hero-visual">{invoice ? <TokenCard invoice={invoice} holder={invoice.advance && invoice.status !== "Repaid" ? contractHolder() : invoice.exporter} network={network()} /> : <article className="tw-card"><p className="tw-eyebrow">Run the demo</p><h2>See an invoice come full circle.</h2><p className="tw-muted">Create, accept, advance and repay a sample invoice. No wallet needed.</p><Link className="tw-button" href="/app/guided">Run the demo → Play both sides</Link></article>}</div></section>
    <section className="tw-explainer"><p className="tw-eyebrow">From goods shipped to cash in hand</p><h2>Your invoice. A shorter wait.</h2><div className="tw-row-3">{[
      { icon: FileCheck2, title: "Upload & AI check", body: "Invoice documents are checked privately by NEAR AI in a secure enclave." },
      { icon: Fingerprint, title: "Buyer accepts", body: "Your buyer confirms the terms. The invoice becomes an NFT on NEAR." },
      { icon: Banknote, title: "Get paid today", body: "The pool advances 70–85%. Your buyer pays from any chain; the contract splits the repayment." },
    ].map(({ icon: Icon, title, body }, i) => <article className="tw-card" key={title}><span className="tw-step-number">0{i + 1}</span><Icon size={28} /><h3>{title}</h3><p className="tw-muted">{body}</p></article>)}</div></section>
    <section className="tw-roadmap"><h2>The road ahead</h2><div>{["Now · testnet sandbox", "Pilot exporters", "Licensed partner · KYB", "Open pool"].map((label, i) => <span key={label}><b>0{i + 1}</b>{label}{i > 0 && <small>Roadmap</small>}</span>)}</div></section>
    <footer className="tw-landing-footer"><img src="/brand/tradewind-logo-white.png" alt="Tradewind" width="152" height="42" /><span>Built at NEAR HACKATHON</span><p>Illustrative pricing · unaudited MVP · sample data is not a real mainnet run</p></footer>
  </div>;
}
