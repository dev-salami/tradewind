"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { explorerTx, formatUsd, ORIGIN_ASSETS, STATUS_LABELS, validRefundAddress, validateRepayAmount, type Invoice, type OneClickStatus, type OriginChain, type QuoteResponse } from "@tradewind/core";
import { network } from "@/lib/env-public";
import { parseAmount } from "@/lib/tx";
import { ChainRing } from "./chain-ring";
import { DirectPayment } from "./invoice-flows";
import { useClientReady } from "./client-ready";

interface Quote { pid?: string; dry: boolean; simulated?: boolean; preview: boolean; amountIn: string; amountInFormatted: string; minAmountIn: string; amountOut: string; depositAddress?: string; depositMemo?: string; deadline: string; timeEstimate: number; path: "A" | "B"; refundFee?: string; withdrawFee?: string; quoteResponse?: QuoteResponse }
interface Progress { status: OneClickStatus; label: string; settlement: { confirmed: boolean }; swapDetails?: { originChainTxHashes: { hash: string }[]; nearTxHashes: string[] } }
async function json<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: body === undefined ? "GET" : "POST", cache: "no-store", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || "Payment request failed");
  return result as T;
}
const originExplorer = { Base: "https://basescan.org/tx/", Arbitrum: "https://arbiscan.io/tx/", Solana: "https://solscan.io/tx/", Ethereum: "https://etherscan.io/tx/" };
export function AnyChainPayment({ invoice, minPayment, liveAllowed, preview, initialPart }: { invoice: Invoice; minPayment: string; liveAllowed: boolean; preview: boolean; initialPart: boolean }) {
  const ready = useClientReady();
  return ready ? <PaymentForm key={invoice.id} invoice={invoice} minPayment={minPayment} liveAllowed={liveAllowed} preview={preview} initialPart={initialPart} /> : null;
}
function PaymentForm({ invoice, minPayment, liveAllowed, preview, initialPart }: { invoice: Invoice; minPayment: string; liveAllowed: boolean; preview: boolean; initialPart: boolean }) {
  const router = useRouter();
  // Restore once, without replaying a quote request or cascading effect updates.
  const [saved] = useState<{ quote: Quote; chain: string; refund: string; amount: string } | undefined>(() => {
    try {
      if (typeof window === "undefined") return;
      const value = JSON.parse(sessionStorage.getItem(`payment:${network()}:${invoice.id}`) || "null");
      if (value?.quote?.pid && value.quote.depositAddress && value.chain in ORIGIN_ASSETS) {
        const n = BigInt(value.quote.amountOut);
        return { ...value, amount: `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, "0")}` };
      }
    } catch { /* Storage can be unavailable; signed quote download is still offered. */ }
  });
  const [chain, setChain] = useState(saved?.chain || "Base"), [part, setPart] = useState(saved ? true : initialPart), [amount, setAmount] = useState(saved?.amount || "");
  const [refund, setRefund] = useState(saved?.refund || ""), [quote, setQuote] = useState<Quote | undefined>(saved?.quote), [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [qrResult, setQr] = useState<{ address: string; svg: string }>(), [txHash, setTxHash] = useState("");
  const qr = qrResult?.address === quote?.depositAddress ? qrResult?.svg : "";
  const [simulation, setSimulation] = useState<{ started: number; steps: { afterMs: number; status: OneClickStatus }[] }>(), [copied, setCopied] = useState(false);
  const outstanding = BigInt(invoice.face) - (BigInt(invoice.paid.total) - BigInt(invoice.paid.overpaid));
  let units = "", validation = "";
  try { units = part ? parseAmount(amount) : outstanding.toString(); validateRepayAmount(BigInt(units), outstanding, BigInt(minPayment)); }
  catch (e) { validation = e instanceof Error ? e.message : "Invalid amount"; }
  const locked = !!quote?.pid || busy;
  const payable = ["Accepted", "Funded", "PartiallyPaid", "Defaulted"].includes(invoice.status) && outstanding > 0n;
  const validRefund = chain !== "NEAR" && validRefundAddress(chain as OriginChain, refund);
  function clear() { setQuote(undefined); setProgress(undefined); setSimulation(undefined); setError(""); setQr(undefined); }
  async function run(action: () => Promise<void>) { setBusy(true); setError(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Payment request failed"); } finally { setBusy(false); } }
  async function requestQuote(live = false) {
    await run(async () => {
      const originAsset = ORIGIN_ASSETS[chain as OriginChain].assetId ?? chain;
      const q = await json<Quote>(`/api/pay/${encodeURIComponent(invoice.id)}/quote`, { originAsset, amount: units, refundTo: refund, live });
      setQuote(q); setQr(undefined); setProgress(undefined); setSimulation(undefined);
      if (q.pid) {
        setProgress({ status: "PENDING_DEPOSIT", label: "Waiting for deposit", settlement: { confirmed: false } });
        try { sessionStorage.setItem(`payment:${network()}:${invoice.id}`, JSON.stringify({ quote: q, chain, refund })); } catch { /* Download remains available. */ }
      }
    });
  }
  useEffect(() => {
    let alive = true;
    const address = quote?.depositAddress;
    if (address) void QRCode.toString(address, { type: "svg", width: 220 }).then(svg => { if (alive) setQr({ address, svg }); }).catch(() => { if (alive) setError("QR unavailable — copy the deposit address instead"); });
    return () => { alive = false; };
  }, [quote?.depositAddress]);
  useEffect(() => {
    if (!quote?.pid) return;
    let alive = true, inFlight = false, done = false;
    const poll = async () => {
      if (inFlight || done) return;
      inFlight = true;
      try {
        const p = await json<Progress>(`/api/pay/intents/${quote.pid}/status`);
        if (alive) {
          setProgress(p); setError("");
          done = p.settlement.confirmed || ["REFUNDED", "FAILED"].includes(p.status);
          if (p.settlement.confirmed) router.refresh();
        }
      } catch (e) { if (alive) setError(`${e instanceof Error ? e.message : "Status unavailable"} — retrying; do not send again.`); }
      finally { inFlight = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [quote?.pid, router]);
  useEffect(() => {
    if (!simulation) return;
    const update = () => {
      const step = [...simulation.steps].reverse().find(s => Date.now() - simulation.started >= s.afterMs)!;
      setProgress({ status: step.status, label: `Simulated: ${STATUS_LABELS[step.status]}`, settlement: { confirmed: false } });
    };
    update(); const timer = setInterval(update, 250);
    const end = setTimeout(() => clearInterval(timer), 6500);
    return () => { clearInterval(timer); clearTimeout(end); };
  }, [simulation]);
  const stage = progress?.status === "SUCCESS" && (simulation || progress.settlement.confirmed) ? 2 : progress?.status === "PROCESSING" || progress?.status === "SUCCESS" ? 1 : 0;
  const hashes = progress?.swapDetails?.originChainTxHashes.map(t => t.hash) ?? (txHash ? [txHash] : []);
  return <div className="tw-stack tw-form">
    <p className="tw-eyebrow">{quote?.simulated ? "Simulated 1Click (local) · Trusted settlement relayer" : !preview && quote && !quote.dry ? "Real cross-chain payment" : "Preview"}</p>
    {preview && !quote?.simulated && <p className="tw-sample-note">1Click is mainnet-only — preview quote, no deposit address on testnet</p>}
    {quote?.simulated && <p role="note">Local simulation only. No real cross-chain funds moved. Never send funds to the fake deposit address.</p>}
    <fieldset className="tw-payment-amount" disabled={locked}><legend>Payment amount</legend><div className="tw-actions"><button className="tw-ghost" aria-pressed={!part} onClick={() => { clear(); setPart(false); }}>Pay full {formatUsd(outstanding)}</button><button className="tw-ghost" aria-pressed={part} onClick={() => { clear(); setPart(true); }}>Pay part</button></div>{part && <label>USDC amount<input inputMode="decimal" value={amount} onChange={e => { clear(); setAmount(e.target.value); }} /></label>}<p className="tw-small tw-muted">Minimum part {formatUsd(minPayment)}; a smaller final balance can be paid exactly.</p></fieldset>
    {validation && <p role="alert">{validation}</p>}
    {!payable && <p role="alert">This invoice has no payable outstanding balance or is not ready for payment.</p>}
    <ChainRing value={chain} disabled={locked} onChange={c => { clear(); setRefund(""); setChain(c); }} />
    {chain === "NEAR" ? <DirectPayment invoice={invoice} minPayment={minPayment} amountUnits={validation ? "" : units} /> : <>
      <label>Refund address on {chain}<input disabled={locked} value={refund} placeholder={chain === "Solana" ? "Solana base58 address" : "0x…"} onChange={e => { clear(); setRefund(e.target.value.trim()); }} /></label>
      {refund && !validRefund && <p role="alert">Enter a valid {chain} refund address.</p>}
      {!quote?.pid && <button className="tw-button" disabled={busy || !payable || !!validation || !validRefund} onClick={() => void requestQuote()}>Preview quote</button>}
      {quote && <div className="tw-quote tw-stack"><p>{quote.simulated ? "Simulated input" : "You send"} <strong>{quote.amountInFormatted} USDC on {chain}</strong> → {quote.simulated ? "simulated invoice amount" : "invoice receives"} <strong>{formatUsd(quote.amountOut, { decimals: 6 }).slice(1)} USDC on NEAR</strong></p><p className="tw-muted">Estimated {quote.timeEstimate} seconds after confirmation. Input includes swap costs and a 1% slippage buffer; unused input is refunded. Origin gas is extra.</p><p className="tw-small tw-break">Minimum input: {quote.minAmountIn} base units · Deadline: {new Date(quote.deadline).toLocaleString()}</p>{quote.path === "B" && <p role="note">Trusted settlement relayer forwards to the invoice contract after delivery; settlement is confirmed only when the payment appears on chain. It holds funds in transit.</p>}</div>}
      {liveAllowed && !quote?.pid && <button className="tw-button" disabled={busy || !payable || !!validation || !validRefund} onClick={() => void requestQuote(true)}>Get deposit address</button>}
      {quote?.withdrawFee !== undefined && <p className="tw-small tw-muted">Destination withdrawal fee (already included in the quote): {formatUsd(quote.withdrawFee, { decimals: 6 })} USDC.</p>}
      {quote?.refundFee !== undefined && <p className="tw-small tw-muted">Quoted refund fee if applicable: {quote.refundFee} origin USDC base units.</p>}
      {quote?.depositAddress && <div className="tw-stack"><p>{quote.simulated ? "Fake deposit address — do not send any funds. Local tUSDC delivery is supplied by the sandbox script." : `Send exactly ${quote.amountInFormatted} USDC on ${chain} from your own wallet, before the deadline. Never send testnet tokens.`}</p><code className="tw-break">{quote.depositAddress}</code>{qr && !quote.simulated && <img width="220" height="220" src={`data:image/svg+xml,${encodeURIComponent(qr)}`} alt="Deposit address QR" />}{quote.depositMemo && <p role="alert">Required deposit memo: <code>{quote.depositMemo}</code>. The QR contains the address only; include this memo separately.</p>}<button className="tw-ghost" onClick={() => void run(async () => { await navigator.clipboard.writeText(quote.depositAddress!); setCopied(true); })}>{copied ? "Copied" : "Copy address"}</button>{quote.quoteResponse && <a className="tw-text-link" download={`quote-${quote.pid}.json`} href={`data:application/json,${encodeURIComponent(JSON.stringify(quote.quoteResponse, null, 2))}`}>Save quote for your records</a>}<label>Deposit tx hash (optional)<input value={txHash} onChange={e => setTxHash(e.target.value.trim())} /></label><button className="tw-ghost" disabled={busy || !/^[A-Za-z0-9]{32,128}$/.test(txHash)} onClick={() => void run(async () => { await json(`/api/pay/intents/${quote.pid}/deposit-tx`, { txHash }); })}>Submit transaction hash</button></div>}
      {preview && !simulation && <button className="tw-ghost" disabled={busy} onClick={() => void run(async () => { const s = await json<{ steps: { afterMs: number; status: OneClickStatus }[] }>(`/api/pay/${encodeURIComponent(invoice.id)}/simulate`, {}); setSimulation({ started: Date.now(), steps: s.steps }); })}>Simulate status steps (no funds)</button>}
      {simulation && <p className="tw-sample-note">Simulation only — no funds moved, no invoice settlement. Actual testnet repayment: choose NEAR and “Pay on NEAR (testnet USDC)”.</p>}
      {progress && <div aria-live="polite"><ol className="tw-timeline">{["Waiting for deposit", "Processing", "Delivered"].map((s, i) => <li key={s} className={stage >= i ? "tw-complete" : ""}><span className="tw-timeline-dot" /><span>{simulation ? "Simulated: " : ""}{s}{i === 2 && !simulation && !progress.settlement.confirmed ? " (invoice confirmation pending)" : ""}</span></li>)}</ol><p role="status">{progress.label}</p>{progress.settlement.confirmed && <p className="tw-green">Payment recorded by the invoice contract.</p>}{hashes.map(hash => <p key={hash}><a target="_blank" rel="noreferrer" href={`${originExplorer[chain as OriginChain]}${encodeURIComponent(hash)}`}>Origin transaction ↗</a></p>)}{progress.swapDetails?.nearTxHashes.map(hash => <p key={hash}><a target="_blank" rel="noreferrer" href={explorerTx(network(), hash) ?? undefined}>NEAR delivery transaction ↗</a></p>)}</div>}
    </>}
    {busy && <p role="status">Requesting…</p>}{error && <p role="alert">{error}</p>}
    {quote?.pid && progress && (progress.settlement.confirmed || ["REFUNDED", "FAILED"].includes(progress.status)) && <button className="tw-ghost" onClick={() => {
      try { sessionStorage.removeItem(`payment:${network()}:${invoice.id}`); } catch { /* Optional persistence. */ }
      clear(); setPart(false); setAmount(""); setTxHash(""); setCopied(false); router.refresh();
    }}>Close completed intent / prepare another payment</button>}
  </div>;
}
