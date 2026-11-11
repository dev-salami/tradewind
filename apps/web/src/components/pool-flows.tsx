"use client";
import { useState } from "react";
import { formatUsd } from "@tradewind/core";
import { coreId, usdcId } from "@/lib/near";
import { depositTx, redeemTx, parseAmount } from "@/lib/tx";
import { useWallet } from "./wallet-provider";
import { ReadState, useView, WriteButton } from "./write-controls";
import { StorageRegistration } from "./account-flows";
export function PoolFlows() {
  const { accountId, callView } = useWallet();
  const [amount, setAmount] = useState(""), [shares, setShares] = useState("");
  const balance = useView<string>("ft_balance_of", { account_id: accountId }, !!accountId);
  const value = useView<string>("preview_redeem", { shares: balance.value || "0" }, !!balance.value);
  const allowed = useView<boolean>("is_lp_allowed", { account_id: accountId }, !!accountId);
  let units = "";
  try { units = parseAmount(shares); } catch { /* Incomplete editable amount. */ }
  const preview = useView<string>("preview_redeem", { shares: units }, !!units);
  return <div className="tw-form"><ReadState loading={balance.loading || allowed.loading} error={balance.error || allowed.error || value.error} />{!accountId && <p>Connect wallet to view your position.</p>}{balance.value !== undefined && <p>{formatUsd(balance.value, { decimals: 6 }).replace("$", "")} twPOOL · value {value.value ? formatUsd(value.value, { decimals: 6 }) : "—"} USDC</p>}
    <p className="tw-small tw-muted">Wallets can display twPOOL. Token contract: {coreId() || "not configured"}. Token decimals: 6.</p><StorageRegistration />
    {allowed.value === false && <p>LP access by invitation during MVP</p>}
    <label>Deposit USDC<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label><WriteButton disabled={!allowed.value} build={async () => { if (!await callView<boolean>("is_lp_allowed", { account_id: accountId })) throw new Error("LP access by invitation during MVP"); return depositTx(usdcId(), coreId(), parseAmount(amount)); }}>Deposit</WriteButton>
    <label>Redeem twPOOL shares<input inputMode="decimal" value={shares} onChange={e => setShares(e.target.value)} /></label><ReadState {...preview} />{preview.value && <p>Receive {formatUsd(preview.value)} USDC · limited by idle liquidity</p>}<WriteButton disabled={!units || !balance.value || BigInt(units || "0") > BigInt(balance.value || "0")} build={() => redeemTx(coreId(), parseAmount(shares))}>Redeem</WriteButton>
  </div>;
}
