"use client";
import { useState } from "react";
import { computeTermsHash, toUnits, sha256Hex } from "@tradewind/core";
import { Card } from "@/components/surfaces";
import { useWallet } from "@/components/wallet-provider";
import { CreateInvoiceFlow } from "@/components/create-invoice-flow";
import { parseAmount } from "@/lib/tx";
type Draft = { draft_id: string; doc_hash: string; exporter: string; extracted: { invoice_number: string; buyer_name: string; total: string; payment_terms_days: number }; checks: { id: string; ok: boolean; note: string }[]; verdict_preview: string; reasons: string[]; signature: string; mock: boolean; verified_ok: boolean };
export default function NewInvoice() {
  const { accountId } = useWallet();
  const [draft, setDraft] = useState<Draft>();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [input, setFields] = useState({ buyer: "", buyer_label: "", invoice_number: "", total: "10.00", tenor_days: "60" });
  const fields = { ...input, exporter: accountId || "" };
  const [shipping, setShipping] = useState<File>();
  function update(key: keyof typeof input, value: string) { setFields(f => ({ ...f, [key]: value })); }
  let termsHash = "Enter valid terms to compute hash";
  try { if (draft) termsHash = computeTermsHash({ ...fields, face: toUnits(fields.total).toString(), tenor_days: Number(fields.tenor_days), doc_hash: draft.doc_hash }); } catch { /* Editable decimals can be incomplete. */ }
  async function upload(file?: File) {
    if (!file || busy) return;
    setBusy(true); setError(""); setDraft(undefined);
    try {
      const localHash = sha256Hex(new Uint8Array(await file.arrayBuffer()));
      const body = new FormData(); body.set("file", file); if (shipping) body.set("shipping", shipping);
      if (!accountId) throw new Error("Connect wallet before uploading");
      body.set("form_fields", JSON.stringify({ ...fields, face: parseAmount(fields.total), tenor_days: Number(fields.tenor_days) }));
      const response = await fetch("/api/invoices/draft", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Upload failed");
      if (result.doc_hash !== localHash) throw new Error("Document hash mismatch; upload again");
      setDraft({ ...result, exporter: accountId });
      setFields(f => ({ ...f, invoice_number: result.extracted.invoice_number || f.invoice_number, buyer_label: result.extracted.buyer_name || f.buyer_label, total: result.extracted.total || f.total, tenor_days: String(result.extracted.payment_terms_days || f.tenor_days) }));
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(false); }
  }
  return <div className="tw-stack"><header><p className="tw-eyebrow">Exporter workspace</p><h1>New invoice</h1><p className="tw-muted">Upload a PDF to prefill editable invoice terms.</p></header><div className="tw-row-2">
    <Card title="Invoice document"><label className="tw-form">Optional shipping PDF (select before invoice)<input type="file" accept="application/pdf" disabled={busy} onChange={e => setShipping(e.target.files?.[0])} /></label>
      <div className="tw-upload-placeholder" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files[0]); }}><strong>Drop invoice PDF · ≤ 5 MB</strong><label>Choose invoice<input aria-label="Invoice PDF" type="file" accept="application/pdf" disabled={busy} onChange={e => void upload(e.target.files?.[0])} /></label></div>
      <p className="tw-muted tw-small">PDF bytes are discarded after checking. Extracted draft text expires in one hour. TLS is enabled; end-to-end encryption is not yet implemented.</p>
      {busy && <p role="status" aria-busy="true">⏳ Checking invoice…</p>}{error && <p role="alert">{error}</p>}
      {draft && <section className="tw-stack" aria-label="AI check panel"><div className="tw-ai-badge">{draft.mock ? "MOCK — not a TEE result" : draft.verified_ok ? "Checked by NEAR AI · private (TEE)" : "NEAR AI result — signature unverified"}</div>{!draft.mock && <p className="tw-muted tw-small">Response signature checked; full TDX hardware verification pending.</p>}<strong>Preview: {draft.verdict_preview}</strong><p className="tw-muted tw-small">Preview checks use the submitted fields. Edited terms will be checked again against the on-chain invoice.</p><ul>{draft.checks.map(c => <li key={c.id}>{c.ok ? "✓" : "✗"} {c.id}: {c.note}</li>)}</ul>{draft.reasons.map((r, i) => <p key={i}>{r}</p>)}<code className="tw-hash" title={draft.signature}>Signature: {draft.signature.slice(0, 26)}…</code><p className="tw-break">Document hash: <code>{draft.doc_hash}</code></p></section>}
    </Card><Card title="Invoice terms"><div className="tw-form"><p>Exporter: {accountId || "Connect wallet"}</p>{([['buyer', 'Buyer NEAR account'], ['buyer_label', 'Buyer name'], ['invoice_number', 'Invoice number'], ['total', 'Face value · USDC'], ['tenor_days', 'Tenor · contract days']] as const).map(([key, label]) => <label key={key}>{label}<input value={fields[key]} onChange={e => update(key, e.target.value)} /></label>)}<p className="tw-break">Terms hash: <code>{termsHash}</code></p><CreateInvoiceFlow draft={draft} fields={fields} busy={busy} /></div></Card>
  </div></div>;
}
