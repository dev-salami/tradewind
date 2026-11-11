"use client";
import { useEffect, useState } from "react";
import { explorerTx } from "@tradewind/core";
import { isFixtureMode, network } from "@/lib/env-public";
import { useWallet } from "./wallet-provider";
import type { ContractTx } from "@/lib/tx";
import type { TxOutcome } from "@/lib/wallet-logic";

export function useView<T>(method: string, args: Record<string, unknown> = {}, enabled = true, contract?: string) {
  const { callView, revision } = useWallet();
  const key = JSON.stringify(args);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ value?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let alive = true;
    if (!enabled || isFixtureMode()) { setState({ loading: false }); return; }
    setState({ loading: true });
    void callView<T>(method, JSON.parse(key), contract).then(value => { if (alive) setState({ value, loading: false }); }).catch(e => { if (alive) setState({ error: String(e), loading: false }); });
    return () => { alive = false; };
  }, [callView, method, key, enabled, contract, revision, attempt]);
  return { ...state, retry: () => setAttempt(n => n + 1) };
}
export function ReadState({ loading, error, retry }: { loading: boolean; error?: string; retry?(): void }) {
  return <>{loading && <p role="status">Loading…</p>}{error && <div role="alert"><p>{error}</p>{retry && <button className="tw-ghost" onClick={retry}>Retry read</button>}</div>}</>;
}
export function TxLink({ hash }: { hash?: string }) {
  if (!hash) return null;
  const url = explorerTx(network(), hash);
  return <p className="tw-break">{url ? <a className="tw-text-link" href={url} target="_blank" rel="noreferrer">{hash} ↗</a> : hash}</p>;
}
export function WriteButton({ children, build, disabled = false, onSuccess }: { children: React.ReactNode; build(): ContractTx | Promise<ContractTx>; disabled?: boolean; onSuccess?(result: TxOutcome): void | Promise<void> }) {
  const { accountId, connect, signAndSend } = useWallet();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [hash, setHash] = useState<string>();
  async function run() {
    if (!accountId) { await connect(); return; }
    setBusy(true); setError("");
    try { const result = await signAndSend(await build()); if (result) { setHash(result.transaction?.hash); await onSuccess?.(result); } }
    catch (e) { setError(e instanceof Error ? e.message : "Transaction failed"); }
    finally { setBusy(false); }
  }
  return <div><button className="tw-button" disabled={disabled || busy || isFixtureMode()} onClick={() => void run()}>{busy ? "Waiting for wallet…" : !accountId ? "Connect wallet" : children}</button>{isFixtureMode() && <p className="tw-muted tw-small">Sample data · read-only preview</p>}{error && <p role="alert">{error}</p>}<TxLink hash={hash} /></div>;
}
