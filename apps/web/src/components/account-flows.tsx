"use client";
import { useEffect, useState } from "react";
import { formatUsd } from "@tradewind/core";
import { coreId, usdcId } from "@/lib/near";
import { claimTx, setApproverTx, usdcStorageDepositTx } from "@/lib/tx";
import { isFixtureMode } from "@/lib/env-public";
import { useWallet } from "./wallet-provider";
import { ReadState, useView, WriteButton } from "./write-controls";
import { Card } from "./surfaces";

export function AccountOnboarding() {
  const { accountId, signInSession } = useWallet();
  const [savedFor, setSavedFor] = useState<string | null>(null), [name, setName] = useState(""), [country, setCountry] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  // Display metadata only; writes require a NEP-413 session for the same account.
  const [profiles, setProfiles] = useState<Record<string, boolean>>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!accountId || isFixtureMode()) return;
    let alive = true;
    void fetch(`/api/accounts?account_id=${encodeURIComponent(accountId)}`).then(async response => {
      if (!response.ok) throw new Error("Profile lookup unavailable");
      const result = await response.json();
      if (alive) { setProfiles(p => ({ ...p, [accountId]: result.registered })); setLoadedFor(accountId); }
    }).catch(() => { if (alive) setLoadedFor(accountId); });
    return () => { alive = false; };
  }, [accountId]);
  if (!accountId || isFixtureMode() || loadedFor !== accountId || savedFor === accountId || profiles[accountId]) return null;
  return <Card title="Set up your exporter profile"><form className="tw-form" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const save = () => fetch("/api/accounts", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account_id: accountId, display_name: name, country }) });
      let response = await save();
      // Profile writes need a wallet-signed (NEP-413) session for this account.
      if (response.status === 401) { await signInSession(); response = await save(); }
      if (!response.ok) throw new Error("Could not save profile");
      setSavedFor(accountId); setProfiles(p => ({ ...p, [accountId]: true }));
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }}><label>Display name<input required maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label><label>Country<input required maxLength={80} value={country} onChange={e => setCountry(e.target.value)} /></label><p className="tw-small tw-muted">Display metadata only. Your wallet and contract determine permissions.</p><button className="tw-button" disabled={busy}>Save profile</button>{error && <p role="alert">{error}</p>}</form></Card>;
}
export function ClaimBanner() {
  const { accountId } = useWallet();
  const claimable = useView<string>("get_claimable", { account_id: accountId }, !!accountId);
  return claimable.value && BigInt(claimable.value) > 0n ? <Card title="USDC ready to collect"><StorageRegistration /><WriteButton build={() => claimTx(coreId())}>Claim {formatUsd(claimable.value)}</WriteButton></Card> : null;
}
export function StorageRegistration() {
  const { accountId, callView } = useWallet();
  const balance = useView<unknown>("storage_balance_of", { account_id: accountId }, !!accountId, usdcId());
  return <>{!accountId && <p>Connect wallet to check USDC registration.</p>}{isFixtureMode() && <p className="tw-muted tw-small">Sample data · storage registration is unavailable in this read-only preview.</p>}<ReadState {...balance} />{balance.value === null && <WriteButton build={async () => {
    const bounds = await callView<{ min: string }>("storage_balance_bounds", {}, usdcId());
    return usdcStorageDepositTx(usdcId(), accountId!, bounds.min);
  }}>Register for USDC (one click)</WriteButton>}{balance.value != null && <p className="tw-green">Registered for USDC</p>}</>;
}
export function SettingsFlows() {
  const { accountId } = useWallet();
  const approver = useView<string | null>("get_approver", { exporter: accountId }, !!accountId);
  const bot = process.env.NEXT_PUBLIC_APPROVER_ACCOUNT_ID;
  return <div className="tw-stack"><Card title="USDC storage registration"><StorageRegistration /></Card><Card title="Telegram approvals"><ReadState {...approver} /><p>Optional: the bot may only request an advance on your invoices. Funds go only to you, never to the bot. It cannot accept invoices, make payments, withdraw your funds or change your terms. A compromised bot could request an unwanted advance with fees. Revoke at any time.</p><p>Current approver: {approver.value ?? "None"}</p><WriteButton disabled={(!bot && !approver.value) || approver.loading || !!approver.error} build={() => setApproverTx(coreId(), approver.value ? null : bot!)}>{approver.value ? "Disable Telegram approvals" : "Enable Telegram approvals"}</WriteButton>{!bot && <p>Telegram approver account is not configured.</p>}</Card><Card title="Link Telegram"><p>Telegram linking arrives in the next step.</p><button className="tw-ghost" disabled>Link Telegram · coming soon</button></Card></div>;
}
