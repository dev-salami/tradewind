"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupModal } from "@near-wallet-selector/modal-ui";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupHotWallet } from "@near-wallet-selector/hot-wallet";
import { explorerTx, viewFunction } from "@tradewind/core";
import { isFixtureMode, network } from "@/lib/env-public";
import { coreId, rpcUrl, txStatus } from "@/lib/near";
import { redirectHashes, txFailed, type TxOutcome } from "@/lib/wallet-logic";
import type { ContractTx } from "@/lib/tx";
import { signIn } from "@/lib/auth-client";

interface WalletContextValue {
  accountId: string | null; connect(): Promise<void>; disconnect(): Promise<void>;
  signAndSend(tx: ContractTx): Promise<TxOutcome | undefined>;
  callView<T>(method: string, args?: Record<string, unknown>, contract?: string): Promise<T>;
  revision: number;
  /** NEP-413 sign-in: creates a server session cookie for the connected account. */
  signInSession(): Promise<void>;
}
const SANDBOX_WALLET_MESSAGE = "Browser wallets are not available on a local sandbox. Use Play both sides, or switch to testnet.";
const WalletContext = createContext<WalletContextValue | null>(null);
export function useWallet() { const value = useContext(WalletContext); if (!value) throw new Error("WalletProvider missing"); return value; }
export function WalletProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const selector = useRef<Promise<WalletSelector> | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const [error, setError] = useState(""), [receipts, setReceipts] = useState<{ hash: string; failed: boolean; warning: string }[]>([]);
  const processed = useRef(new Set<string>());
  const initialize = useCallback(() => {
    // Hosted wallets (MyNearWallet, Meteor, HOT) have no local-sandbox config; use guided mode there.
    if (network() === "sandbox") return Promise.reject(new Error(SANDBOX_WALLET_MESSAGE));
    if (!selector.current) selector.current = setupWalletSelector({
      network: network() === "sandbox" ? { networkId: "sandbox", nodeUrl: rpcUrl(), helperUrl: "http://127.0.0.1:3000", explorerUrl: "http://127.0.0.1:9001", indexerUrl: "http://127.0.0.1:3000" } : network() as "testnet" | "mainnet",
      modules: [setupMyNearWallet(), setupMeteorWallet(), setupHotWallet()],
    }).catch(e => { selector.current = null; throw e; });
    return selector.current;
  }, []);
  const callView = useCallback(<T,>(method: string, args: Record<string, unknown> = {}, contract = coreId()) => {
    if (!contract) return Promise.reject(new Error("Contract account is not configured"));
    return viewFunction<T>(rpcUrl(), contract, method, args);
  }, []);
  const complete = useCallback(async (hash: string, account: string) => {
    let warning = "", result: TxOutcome | undefined;
    try {
      const response = await fetch("/api/tx/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tx_hash: hash, account_id: account }) });
      if (!response.ok) warning = "Receipt indexing unavailable; hash retained.";
    } catch { warning = "Receipt indexing unavailable; hash retained."; }
    try { result = await txStatus(hash, account); } catch (e) { warning = e instanceof Error ? e.message : "Status unavailable"; }
    setReceipts(rows => [...rows.filter(r => r.hash !== hash), { hash, failed: result ? txFailed(result) : false, warning }]);
    setRevision(n => n + 1); router.refresh();
    return result;
  }, [router]);
  useEffect(() => {
    let alive = true, unsubscribe: (() => void) | undefined;
    void initialize().then(s => {
      if (!alive) return;
      const sync = () => setAccountId(s.store.getState().accounts.find(a => a.active)?.accountId || null);
      sync(); const subscription = s.store.observable.subscribe(sync); unsubscribe = () => subscription.unsubscribe();
      const url = new URL(window.location.href);
      const walletError = url.searchParams.get("errorMessage") || url.searchParams.get("errorCode");
      if (walletError) setError(`Wallet: ${walletError}`);
      const account = sessionStorage.getItem("tw:signer") || s.store.getState().accounts.find(a => a.active)?.accountId;
      const hashes = redirectHashes(url.href);
      if (account && hashes.length) {
        void Promise.all(hashes.filter(hash => !processed.current.has(hash)).map(async hash => {
          processed.current.add(hash); return complete(hash, account);
        })).then(results => {
          // Keep the query for a retry if finality/RPC was unavailable.
          if (results.every(Boolean)) {
            url.searchParams.delete("transactionHashes");
            window.history.replaceState(null, "", url.pathname + url.search + url.hash);
          }
        });
      }
    }).catch(e => { if (alive && network() !== "sandbox") setError(e instanceof Error ? e.message : "Wallet initialization failed"); });
    return () => { alive = false; unsubscribe?.(); };
  }, [initialize, complete]);
  async function connect() {
    try { setError(""); const s = await initialize(); if (!coreId()) throw new Error("Set NEXT_PUBLIC_CORE_CONTRACT_ID"); setupModal(s, { contractId: coreId() }).show(); }
    catch (e) { setError(e instanceof Error ? e.message : "Connection failed"); }
  }
  async function disconnect() { try { const wallet = await (await initialize()).wallet(); await wallet.signOut(); setAccountId(null); sessionStorage.removeItem("tw:signer"); } catch (e) { setError(String(e)); } }
  async function signInSession() {
    if (isFixtureMode()) throw new Error("Sample data is read-only.");
    if (!accountId) throw new Error("Connect wallet first");
    const wallet = await (await initialize()).wallet();
    const result = await signIn(wallet as unknown as Parameters<typeof signIn>[0]);
    if (result.accountId !== accountId) throw new Error("Signed-in account does not match connected wallet");
  }
  async function signAndSend(tx: ContractTx) {
    if (isFixtureMode()) throw new Error("Sample data is read-only. Select RPC mode to sign transactions.");
    if (!accountId) throw new Error("Connect wallet first");
    sessionStorage.setItem("tw:signer", accountId);
    const wallet = await (await initialize()).wallet();
    const raw = await wallet.signAndSendTransaction({ ...tx, signerId: accountId });
    if (!raw) return; // Redirect wallet resumes through transactionHashes.
    const hash = raw.transaction.hash;
    const result = await complete(hash, accountId);
    if (!result) throw new Error(`Transaction submitted (${hash}); check receipt before retrying`);
    if (txFailed(result)) throw new Error(`Transaction failed (${hash}); inspect receipt`);
    return result;
  }
  return <WalletContext.Provider value={{ accountId, connect, disconnect, signAndSend, callView, revision, signInSession }}>
    {children}
    {error && <div className="tw-wallet-notice" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
    <div className="tw-toasts" aria-live="polite">{receipts.map(r => <div className="tw-card" key={r.hash}><strong>{r.failed ? "Transaction failed" : r.warning ? "Transaction submitted" : "Transaction confirmed"}</strong><p className="tw-break">{explorerTx(network(), r.hash) ? <a href={explorerTx(network(), r.hash)!} target="_blank" rel="noreferrer">{r.hash} ↗ NearBlocks</a> : r.hash}</p>{r.warning && <p>{r.warning}</p>}<button onClick={() => setReceipts(rows => rows.filter(x => x.hash !== r.hash))}>Dismiss</button></div>)}</div>
  </WalletContext.Provider>;
}
export function WalletMenu() {
  const { accountId, connect, disconnect } = useWallet();
  return accountId ? <details><summary className="tw-ghost">{accountId}</summary><p>{network()}</p><button className="tw-ghost" onClick={() => void disconnect()}>Disconnect</button></details> : <button className="tw-button tw-connect" onClick={() => void connect()}>Connect wallet</button>;
}
