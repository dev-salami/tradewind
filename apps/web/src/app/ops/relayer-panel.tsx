"use client";
import { useState } from "react";
import { explorerTx, formatUsd } from "@tradewind/core";
import { network } from "@/lib/env-public";
import { isOwner } from "@/lib/wallet-logic";
import { useWallet } from "@/components/wallet-provider";
import { useView } from "@/components/write-controls";

interface Row { pid: string; invoice_id: string; state: string; amount_e6: string; tx_hash: string | null; reason: string }
export function RelayerPanel() {
  const { accountId } = useWallet();
  const roles = useView<{ owner: string }>("get_roles", {}, !!accountId);
  const [rows, setRows] = useState<Row[]>([]), [error, setError] = useState("");
  if (!isOwner(accountId, roles.value?.owner)) return null;
  return <section className="tw-stack"><h2>Relayer</h2><p>Trusted settlement relayer · holds funds in transit. Read only; chain payments are the settlement source of truth.</p><button className="tw-ghost" onClick={async () => {
    try { const response = await fetch("/ops/relayer", { cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setRows(result.rows); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Unable to read relayer rows"); }
  }}>Refresh relayer (authenticated owner session required)</button>{error && <p role="alert">{error}</p>}<table><thead><tr><th>Invoice / payment</th><th>State</th><th>Amount</th><th>Transaction</th><th>Reason</th></tr></thead><tbody>{rows.map(row => <tr key={row.pid}><td>{row.invoice_id}<br />{row.pid}</td><td>{row.state}</td><td>{formatUsd(row.amount_e6)}</td><td>{row.tx_hash && (explorerTx(network(), row.tx_hash) ? <a href={explorerTx(network(), row.tx_hash)!} target="_blank" rel="noreferrer">{row.tx_hash}</a> : row.tx_hash)}</td><td>{row.reason}</td></tr>)}</tbody></table></section>;
}
