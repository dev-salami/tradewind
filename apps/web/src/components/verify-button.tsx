"use client";
import { useState } from "react";
import { verifyPublicSignature, type PublicProof } from "@/lib/verify-signature";
import { fixtureProof } from "@/lib/fixture-proof";
export function VerifyButton({ id, fixture }: { id: string; fixture: boolean }) {
  const [status, setStatus] = useState(""), [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<PublicProof>();
  async function verify() {
    setBusy(true); setStatus(""); setEvidence(undefined);
    try {
      let proof: PublicProof;
      if (fixture) proof = fixtureProof;
      else { const response = await fetch(`/api/verify/${encodeURIComponent(id)}`, { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Verification unavailable"); proof = data; }
      setEvidence(proof);
      await verifyPublicSignature(proof); setStatus(`Signature valid ✓${proof.mock ? " · MOCK — public test key, not a TEE result" : fixture ? " · fixture (not a TEE result)" : ""}`);
    } catch (e) { setStatus(e instanceof Error ? e.message : "Signature verification failed"); }
    finally { setBusy(false); }
  }
  return <div><button className="tw-button" disabled={busy} onClick={() => void verify()}>{busy ? "Verifying…" : "Verify"}</button><p role="status">{status}</p>{evidence?.source && <p>{evidence.source === "chain" ? `Read from NEAR contract ${evidence.contract}` : "Read from local cache"}</p>}{evidence?.mock && <strong>MOCK</strong>}{!evidence?.mock && evidence?.attestation_summary && <ul>{evidence.attestation_summary.steps.map(step => <li key={step.id}>{step.ok ? "✓" : "✗"} {step.id}: {step.detail}</li>)}</ul>}<p className="tw-muted tw-small">Browser checks the signed payload against the published signer. Attestation steps are server-reported, not browser-verified; they do not establish invoice authenticity.</p><a className="tw-text-link" href="https://cloud.near.ai/verify" target="_blank" rel="noreferrer">NEAR AI Verification Center ↗</a></div>;
}
