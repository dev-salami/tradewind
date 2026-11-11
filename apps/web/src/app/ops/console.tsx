"use client";
import { useState } from "react";
import { OpsFlows } from "@/components/ops-flows";
import { useWallet } from "@/components/wallet-provider";
import { useOwnerAccess } from "./access";
import { EditableSettings } from "./settings";

export function OpsConsole() {
  const { allowed, refresh } = useOwnerAccess();
  const { accountId, signInSession } = useWallet();
  const [error, setError] = useState("");
  if (!allowed) return <section><h2>403 · Owner access only</h2><p>Connect the CORE owner wallet and sign in to access Operations. No settings are available to other accounts.</p>{accountId && <button className="tw-button" onClick={async () => { try { await signInSession(); await refresh(); window.dispatchEvent(new Event("ops-session")); } catch { setError("Owner sign-in unavailable. Check your wallet and try again."); } }}>Sign in as owner</button>}{error && <p role="alert">{error}</p>}</section>;
  return <><EditableSettings /><OpsFlows /></>;
}
