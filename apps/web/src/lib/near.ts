import { NETWORKS } from "@tradewind/core";
import { network } from "./env-public";
import type { TxOutcome } from "./wallet-logic";
export const rpcUrl = () => process.env.NEXT_PUBLIC_NEAR_RPC_URL || NETWORKS[network()];
export const coreId = () => process.env.NEXT_PUBLIC_CORE_CONTRACT_ID || "";
export const usdcId = () => process.env.NEXT_PUBLIC_USDC_CONTRACT_ID || "";
export async function txStatus(hash: string, account: string): Promise<TxOutcome> {
  const response = await fetch(rpcUrl(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "tx", method: "tx", params: { tx_hash: hash, sender_account_id: account, wait_until: "FINAL" } }), signal: AbortSignal.timeout(20000) });
  const payload = await response.json();
  if (!response.ok || payload.error || !payload.result) throw new Error("Transaction status unavailable; retry without signing again");
  return payload.result;
}
