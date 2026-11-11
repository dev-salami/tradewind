"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { network } from "@/lib/env-public";
import { emptyGuidedProgress, GUIDED_STORAGE_KEY, guidedAvailable, guidedStepEnabled, guidedUnits, resumeGuided, testnetTxLinks, type GuidedProgress, type GuidedResult, type GuidedStep } from "@/lib/guided-steps";
import { Card, Pill } from "./surfaces";

function useGuidedAvailability() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (network() === "mainnet") return;
    let alive = true;
    void fetch("/api/guided/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store" })
      .then(async response => {
        if (!response.ok) return;
        const body = await response.json() as { available?: unknown };
        if (alive) setAvailable(guidedAvailable(network(), response.status, body));
      }).catch(() => { /* Unavailable guided mode is intentionally silent. */ });
    return () => { alive = false; };
  }, []);
  return network() !== "mainnet" && available;
}

export function GuidedNavLink({ active }: { active: boolean }) {
  const available = useGuidedAvailability();
  return available ? <Link href="/app/guided" className={active ? "active" : ""} aria-current={active ? "page" : undefined}>Play both sides</Link> : null;
}

export function GuidedMode() {
  const available = useGuidedAvailability();
  const [progress, setProgress] = useState<GuidedProgress>(emptyGuidedProgress);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [face, setFace] = useState(""), [amount, setAmount] = useState("");
  const [error, setError] = useState(""), [storageWarning, setStorageWarning] = useState("");
  const running = useRef(false);
  useEffect(() => {
    try { setProgress(resumeGuided(window.sessionStorage)); }
    catch { setStorageWarning("Session storage unavailable; keep this page open to retain progress."); }
    setReady(true);
  }, []);
  function save(value: GuidedProgress) {
    setProgress(value);
    try { window.sessionStorage.setItem(GUIDED_STORAGE_KEY, JSON.stringify(value)); }
    catch { setStorageWarning("Session storage unavailable; keep this page open to retain progress."); }
  }
  async function run(step: GuidedStep, part = false) {
    if (!available || !ready || running.current || !guidedStepEnabled(progress, step, busy)) return;
    let body: Record<string, string> = step === "invoice" ? {} : { invoice_id: progress.invoice_id! };
    try {
      if (step === "invoice" && face !== "") body = { face: guidedUnits(face) };
      if (step === "pay" && part) body.amount = guidedUnits(amount);
    } catch (e) { setError(e instanceof Error ? e.message : "Invalid amount"); return; }
    running.current = true; setBusy(true); setError("");
    // An interrupted write must not be automatically replayed after refresh.
    save({ ...progress, paused: true });
    try {
      const response = await fetch(`/api/guided/${step}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
      const payload = await response.json() as { invoice_id?: string; tx_links?: unknown; verdict?: string; mock?: boolean; error?: string };
      const id = typeof payload.invoice_id === "string" && /^TW-\d{4,20}$/.test(payload.invoice_id) ? payload.invoice_id : progress.invoice_id;
      const result: GuidedResult = { step, invoice_id: id, tx_links: testnetTxLinks(payload.tx_links), verdict: payload.verdict, mock: payload.mock, error: response.ok ? undefined : payload.error || "Guided request failed" };
      const missingId = response.ok && !id;
      const paused = missingId || (!response.ok && (result.tx_links.length > 0 || (step === "invoice" && !!id))) || (step === "invoice" && response.ok && payload.verdict !== "pass");
      save({ invoice_id: id, next: response.ok && !missingId ? (step === "pay" && part ? 3 : progress.next + 1) : progress.next, paused, results: [...progress.results, result] });
      if (missingId) setError("Missing invoice ID; inspect the returned transactions before continuing.");
    } catch {
      setError("Request outcome unknown. Inspect chain state before starting another sample.");
    } finally { running.current = false; setBusy(false); }
  }
  if (!available || network() === "mainnet") return null;
  const disabled = (step: GuidedStep) => !ready || !guidedStepEnabled(progress, step, busy);
  return <div className="tw-stack">
    <header><p className="tw-eyebrow">Tradewind · guided demo</p><h1>Play both sides</h1><p className="tw-muted">Testnet only · demo accounts sign for you · no real funds</p></header>
    <Card title="Follow a sample invoice" action={<Pill value={busy ? "Submitting…" : "Testnet only"} tone="amber" />}>
      <div className="tw-form" aria-busy={busy}>
        <label>Sample invoice face (USD, optional)<input inputMode="decimal" placeholder="10.00" value={face} disabled={disabled("invoice")} onChange={e => setFace(e.target.value)} /></label>
        <button className="tw-button" disabled={disabled("invoice")} onClick={() => void run("invoice")}>1 · Create sample invoice</button>
        <button className="tw-button" disabled={disabled("accept")} onClick={() => void run("accept")}>2 · Buyer accepts</button>
        <button className="tw-button" disabled={disabled("advance")} onClick={() => void run("advance")}>3 · Request advance</button>
        <p>4 · Buyer pays</p>
        <button className="tw-button" disabled={disabled("pay")} onClick={() => void run("pay")}>Pay full</button>
        <label>Part payment (USD)<input inputMode="decimal" value={amount} disabled={disabled("pay")} onChange={e => setAmount(e.target.value)} /></label>
        <button className="tw-button" disabled={disabled("pay") || !amount} onClick={() => void run("pay", true)}>Pay part</button>
      </div>
      {progress.invoice_id && <p className="tw-toolbar"><Link className="tw-text-link" href={`/app/i/${progress.invoice_id}`}>Invoice {progress.invoice_id} (sample) ↗</Link><Link className="tw-text-link" href={`/r/${progress.invoice_id}`}>Public receipt ↗</Link></p>}
      {error && <p role="alert">{error}</p>}
      {storageWarning && <p role="status">{storageWarning}</p>}
      {progress.paused && !busy && <p className="tw-alert">Flow paused. Inspect the invoice and transactions before taking further action; do not blindly retry a partial operation.</p>}
      {progress.next === 4 && <p role="status">Full payment submitted. Check the receipt for on-chain repayment attribution.</p>}
      {(progress.paused || progress.next === 4) && <button className="tw-ghost" disabled={busy} onClick={() => { save(emptyGuidedProgress()); setError(""); }}>Start another sample (does not undo transactions)</button>}
    </Card>
    {progress.results.map((result, index) => <Card key={index} title={`${index + 1} · ${result.step}`}>
      {result.error && <p role="alert">{result.error}</p>}
      {result.verdict && <p>AI verdict: {result.verdict}</p>}
      {result.mock === true && <p className="tw-muted">Mock AI check — not a TEE result</p>}
      {result.tx_links.map(link => <p key={link}><a className="tw-text-link tw-break" href={link} target="_blank" rel="noreferrer">View on NearBlocks ↗</a> <span className="tw-small tw-muted">testnet</span></p>)}
    </Card>)}
    <p className="tw-muted tw-small">Local progress is a guide, not chain state. Partial payments keep the payment step open. Sandbox transactions will not appear on NearBlocks testnet.</p>
  </div>;
}
