"use client";
import { useState } from "react";
import { ArrowDown } from "lucide-react";
const CHAINS = ["Base", "Arbitrum", "Solana", "Ethereum", "NEAR"];
export function ChainRing({ value, onChange, disabled = false }: { value?: string; onChange?(chain: string): void; disabled?: boolean }) {
  const [selected, setSelected] = useState("Base");
  const chain = value ?? selected;
  const setChain = (name: string) => { setSelected(name); onChange?.(name); };
  return <div className="tw-stack"><div className="tw-chain-ring" role="group" aria-label="Origin chain">{CHAINS.map((name, i) => <button disabled={disabled} className={`tw-chain tw-chain-${i} ${chain === name ? "active" : ""}`} aria-pressed={chain === name} key={name} onClick={() => setChain(name)}><span aria-hidden="true">{name.slice(0, 1)}</span>{name}</button>)}<div className="tw-chain-center"><img src="/brand/tradewind-mark.svg" width="48" height="48" alt="Tradewind" /><small>Any chain → NEAR</small></div></div>
    <div className="tw-quote"><p>You choose <strong>{chain}</strong></p><ArrowDown size={20} aria-hidden="true" /><p>Invoice receives USDC on NEAR</p><p className="tw-muted">{chain === "NEAR" ? "Direct wallet payment · Path C" : "Quotes via NEAR Intents 1Click"}</p></div>
  </div>;
}
