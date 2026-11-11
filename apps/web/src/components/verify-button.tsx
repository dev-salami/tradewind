"use client";
import { useState } from "react";
import { verifyPublicSignature, type PublicProof } from "@/lib/verify-signature";
import { fixtureProof } from "@/lib/fixture-proof";
export function VerifyButton({ id, fixture }: { id: string; fixture: boolean }) {
  const [status, setStatus] = useState(""), [busy, setBusy] = useState(false);
  async function verify() {
    setBusy(true); setStatus("");
    try {
      let proof: PublicProof;
      if (fixture) proof = fixtureProof;
      else { const response = await fetch(`/api/verify/${encodeURIComponent(id)}`, { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Verification unavailable"); proof = data; }
      await verifyPublicSignature(proof); setStatus(`Signature valid ✓${fixture ? " · fixture (not a TEE result)" : ""}`);
    } catch (e) { setStatus(e instanceof Error ? e.message : "Signature verification failed"); }
    finally { setBusy(false); }
  }
  return <div><button className="tw-button" disabled={busy} onClick={() => void verify()}>{busy ? "Verifying…" : "Verify"}</button><p role="status">{status}</p><p className="tw-muted tw-small">Checks the signed payload and recovered signer, not hardware attestation or invoice authenticity.</p><a className="tw-text-link" href="https://cloud.near.ai/verify" target="_blank" rel="noreferrer">NEAR AI Verification Center ↗</a></div>;
}
