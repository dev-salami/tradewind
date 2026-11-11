"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { computeTermsHash, type Invoice, type Config } from "@tradewind/core";
import { coreId } from "@/lib/near";
import { network } from "@/lib/data";
import { createInvoiceTx, parseAmount } from "@/lib/tx";
import { invoiceCreatedId, newestMatchingInvoice, type TxOutcome } from "@/lib/wallet-logic";
import { useWallet } from "./wallet-provider";
import { WriteButton } from "./write-controls";
type Draft = { draft_id: string; doc_hash: string; exporter: string };
type Fields = { buyer: string; buyer_label: string; invoice_number: string; total: string; tenor_days: string };
interface Pending { draft: Draft; account: string; network: string; core: string; existing: string[]; invoiceId?: string }
const KEY = "tw:create-pending";
export function CreateInvoiceFlow({ draft, fields, busy }: { draft?: Draft; fields: Fields; busy: boolean }) {
  const { accountId, callView, revision } = useWallet();
  const [pending, setPending] = useState(false), [created, setCreated] = useState(""), [error, setError] = useState(""), [checking, setChecking] = useState(false), [verdict, setVerdict] = useState("");
  const lock = useRef(false);
  const finish = useCallback(async (result?: TxOutcome) => {
    if (lock.current || !accountId) return;
    const stored = sessionStorage.getItem(KEY);
    if (!stored) return;
    lock.current = true; setChecking(true); setError("");
    try {
      const p: Pending = JSON.parse(stored);
      if (p.account !== accountId || p.network !== network() || p.core !== coreId()) throw new Error("Connect the original exporter on the original network to resume this draft");
      let id = invoiceCreatedId(result || {}) || p.invoiceId;
      if (!id) {
        const invoices = await callView<Invoice[]>("invoices_by_exporter", { account_id: accountId });
        id = newestMatchingInvoice(invoices, p.draft.doc_hash, p.existing)?.id;
      }
      if (!id) throw new Error("Created invoice not found yet. If you cancelled in the wallet, discard this pending draft; otherwise retry recovery without signing again.");
      p.invoiceId = id; sessionStorage.setItem(KEY, JSON.stringify(p)); setCreated(id);
      const current = await callView<Invoice>("get_invoice", { id });
      if (current.status === "Created") {
        const response = await fetch(`/api/invoices/${encodeURIComponent(id)}/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft_id: p.draft.draft_id }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "On-chain invoice created; verification unavailable");
        setVerdict(`Verification: ${body.verdict}`);
      } else setVerdict(`On-chain status: ${current.status}`);
      sessionStorage.removeItem(KEY); setPending(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Invoice recovery failed"); }
    finally { lock.current = false; setChecking(false); }
  }, [accountId, callView]);
  useEffect(() => {
    const p = sessionStorage.getItem(KEY);
    setPending(!!p);
    if (p && accountId) void finish();
  }, [accountId, revision, finish]);
  return <div className="tw-stack">
    <WriteButton disabled={!draft || busy || checking || pending || !!created} build={async () => {
      if (!draft || !accountId) throw new Error("Connect wallet and check a PDF first");
      if (draft.exporter !== accountId) throw new Error("Connect the account that uploaded this draft or upload again");
      const face = parseAmount(fields.total), tenor = Number(fields.tenor_days);
      if (!Number.isInteger(tenor) || tenor < 1 || tenor > 365) throw new Error("Tenor must be 1–365 days");
      if (!/^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$/.test(fields.buyer) || fields.buyer === accountId) throw new Error("Enter a different, valid buyer NEAR account");
      if (fields.invoice_number.length > 64 || fields.buyer_label.length > 80) throw new Error("Invoice number or buyer label is too long");
      const [config, existing] = await Promise.all([callView<Config>("get_config"), callView<Invoice[]>("invoices_by_exporter", { account_id: accountId })]);
      if (BigInt(face) > BigInt(config.max_face)) throw new Error("Face exceeds configured maximum");
      const terms_hash = computeTermsHash({ exporter: accountId, ...fields, face, tenor_days: tenor, doc_hash: draft.doc_hash });
      sessionStorage.setItem(KEY, JSON.stringify({ draft, account: accountId, network: network(), core: coreId(), existing: existing.map(i => i.id) } satisfies Pending));
      setPending(true);
      return createInvoiceTx(coreId(), { buyer: fields.buyer, buyer_label: fields.buyer_label, invoice_number: fields.invoice_number, face, tenor_days: tenor, doc_hash: draft.doc_hash, terms_hash });
    }} onSuccess={finish}>Create on-chain</WriteButton>
    <p className="tw-small tw-muted">Attaches 0.05 NEAR for storage; the contract refunds the excess.</p>
    {pending && <div><button className="tw-ghost" disabled={checking} onClick={() => void finish()}>Resume verification · do not sign again</button><button className="tw-ghost" disabled={checking} onClick={() => { if (window.confirm("Discard local recovery only? This does not cancel an on-chain invoice. Check your dashboard before creating another.")) { sessionStorage.removeItem(KEY); setPending(false); } }}>Discard local recovery</button></div>}
    {checking && <p role="status">Finding created invoice and checking…</p>}{error && <p role="alert">{error}</p>}
    {created && <><p>Created {created} · {verdict || "Checking"}</p><Link className="tw-text-link" href={`/app/i/${created}`}>Open invoice ↗</Link><button className="tw-ghost" onClick={async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/b/${created}`); setVerdict(v => `${v} · buyer link copied`); } catch { setError(`Copy this link: ${window.location.origin}/b/${created}`); } }}>Copy buyer link</button></>}
  </div>;
}
