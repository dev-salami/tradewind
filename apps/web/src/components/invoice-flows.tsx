"use client";
import { useEffect, useRef, useState } from "react";
import { formatUsd, type AdvancePreview, type Invoice } from "@tradewind/core";
import { coreId, usdcId } from "@/lib/near";
import { acceptInvoiceTx, cancelInvoiceTx, requestAdvanceTx, repayDirectTx, parseAmount } from "@/lib/tx";
import { useWallet } from "./wallet-provider";
import { ReadState, useView, WriteButton } from "./write-controls";
import { StorageRegistration } from "./account-flows";

export function AcceptInvoice({ invoice }: { invoice: Invoice }) {
  const { accountId } = useWallet();
  if (invoice.accepted_at) return null; // Already accepted on-chain; the pill above says so.
  return <div>{accountId && accountId !== invoice.buyer && <p role="alert">Connect {invoice.buyer} to accept this invoice. Currently connected: {accountId}.</p>}<WriteButton disabled={!!invoice.accepted_at || invoice.status !== "Verified" || (!!accountId && accountId !== invoice.buyer)} build={() => acceptInvoiceTx(coreId(), invoice.id, invoice.terms_hash)}>Accept invoice</WriteButton></div>;
}
export function AdvanceInvoice({ invoice }: { invoice: Invoice }) {
  const { accountId, callView } = useWallet();
  const panel = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState(false), [sent, setSent] = useState(false);
  const preview = useView<AdvancePreview>("preview_advance", { id: invoice.id });
  const storage = useView<unknown>("storage_balance_of", { account_id: accountId }, !!accountId, usdcId());
  useEffect(() => { if (new URLSearchParams(window.location.search).get("advance") === "1") { setHighlight(true); panel.current?.scrollIntoView({ behavior: "smooth", block: "center" }); } }, []);
  return <div ref={panel} id="advance" className={highlight ? "tw-advance-focus" : ""} tabIndex={-1}>
    <ReadState {...preview} />{preview.value && !preview.value.eligible && <p>{preview.value.reason}</p>}
    {accountId && accountId !== invoice.exporter && <p>Connect exporter {invoice.exporter} to request this advance.</p>}
    <StorageRegistration />
    <WriteButton disabled={!!accountId && accountId !== invoice.exporter || !preview.value?.eligible || storage.loading || storage.value == null || !!storage.error} build={async () => {
      // Fresh preview binds the wallet approval to the current rate and amount.
      const fresh = await callView<AdvancePreview>("preview_advance", { id: invoice.id });
      if (!fresh.eligible) throw new Error(fresh.reason || "Not eligible");
      return requestAdvanceTx(coreId(), invoice.id, invoice.terms_hash, fresh.advance);
    }} onSuccess={async () => {
      const updated = await callView<Invoice>("get_invoice", { id: invoice.id });
      if (updated.status !== "Funded") throw new Error("Advance not funded: transfer reverted or is pending. Check invoice before retrying.");
      setSent(true);
    }}>Get advance</WriteButton>
    {(sent || invoice.status === "Funded") && invoice.advance && <p className="tw-green">Advance {invoice.advance.rate_bps / 100}% → {formatUsd(invoice.advance.amount)} USDC sent to your wallet</p>}
  </div>;
}
export function CancelInvoice({ invoice }: { invoice: Invoice }) {
  const { accountId } = useWallet();
  return accountId === invoice.exporter && ["Created", "Verified", "Rejected"].includes(invoice.status) ? <WriteButton build={() => cancelInvoiceTx(coreId(), invoice.id)}>Cancel invoice</WriteButton> : null;
}
export function DirectPayment({ invoice, minPayment }: { invoice: Invoice; minPayment: string }) {
  const { accountId, callView } = useWallet();
  const [amount, setAmount] = useState("");
  const [chain, setChain] = useState("NEAR");
  const outstanding = BigInt(invoice.face) - BigInt(invoice.paid.total) + BigInt(invoice.paid.overpaid);
  const full = `${outstanding / 1000000n}.${(outstanding % 1000000n).toString().padStart(6, "0")}`;
  return <div className="tw-form"><label>Chain<select value={chain} onChange={e => setChain(e.target.value)}>{["NEAR", "Base", "Arbitrum", "Solana", "Ethereum"].map(c => <option key={c}>{c}</option>)}</select></label>{chain !== "NEAR" ? <p>1Click payments arrive in the next step. No quote or deposit address has been created.</p> : <><p>Direct USDC payment on NEAR. Minimum partial payment {formatUsd(minPayment)}; a smaller final balance can be paid in full.</p><label>USDC amount<input inputMode="decimal" placeholder={full} value={amount} onChange={e => setAmount(e.target.value)} /></label><button className="tw-ghost" onClick={() => setAmount(full)}>Pay full {formatUsd(outstanding)}</button>{accountId && accountId !== invoice.buyer && <p>Connect buyer {invoice.buyer} to pay here.</p>}<WriteButton disabled={outstanding <= 0n || !["Accepted", "Funded", "PartiallyPaid", "Defaulted"].includes(invoice.status) || !!accountId && accountId !== invoice.buyer} build={async () => {
      const units = parseAmount(amount || full);
      const [fresh, config] = await Promise.all([callView<Invoice>("get_invoice", { id: invoice.id }), callView<{ min_payment: string }>("get_config")]);
      const due = BigInt(fresh.face) - BigInt(fresh.paid.total) + BigInt(fresh.paid.overpaid);
      if (BigInt(units) > due || (BigInt(units) < BigInt(config.min_payment) && BigInt(units) !== due)) throw new Error("Payment must be at least min_payment and not exceed outstanding (or pay the final balance exactly)");
      return repayDirectTx(usdcId(), coreId(), invoice.id, units);
    }}>Pay USDC on NEAR</WriteButton></>}</div>;
}
