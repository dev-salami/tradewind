"use client";
import { useState } from "react";
import { ArrowDown } from "lucide-react";
const CHAINS = ["Base", "Arbitrum", "Solana", "Ethereum", "NEAR"];
export function ChainRing() {
  const [chain, setChain] = useState("Base");
  return <div className="tw-stack"><div className="tw-chain-ring" role="group" aria-label="Origin chain">{CHAINS.map((name, i) => <button className={`tw-chain tw-chain-${i} ${chain === name ? "active" : ""}`} aria-pressed={chain === name} key={name} onClick={() => setChain(name)}><span aria-hidden="true">{name.slice(0, 1)}</span>{name}</button>)}<div className="tw-chain-center"><img src="/brand/tradewind-mark.svg" width="48" height="48" alt="Tradewind" /><small>Any chain → NEAR</small></div></div>
    <div className="tw-quote"><p>You choose <strong>{chain}</strong></p><ArrowDown size={20} aria-hidden="true" /><p>Invoice receives USDC on NEAR</p><p className="tw-muted">Quotes via NEAR Intents 1Click — wired in a later step</p></div>
  </div>;
}
