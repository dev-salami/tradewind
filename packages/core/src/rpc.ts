import type { AdvancePreview, BuyerRecord, Config, Invoice, Pool, StrayPayment } from "./types";
export const NETWORKS = {
  testnet: "https://rpc.testnet.near.org", mainnet: "https://rpc.mainnet.near.org", sandbox: "http://127.0.0.1:3030",
} as const;
export type NearNetwork = keyof typeof NETWORKS;
export async function viewFunction<T>(rpcUrl: string, contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  const args_base64 = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""));
  const response = await fetch(rpcUrl, {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: "tradewind-view", method: "query", params: {
      request_type: "call_function", finality: "final", account_id: contractId, method_name: method, args_base64,
    } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`NEAR RPC HTTP ${response.status}`);
  const payload = await response.json() as { error?: unknown; result?: { result?: number[]; error?: unknown } };
  if (payload.error || payload.result?.error) throw new Error(`NEAR view ${method} failed: ${JSON.stringify(payload.error ?? payload.result?.error)}`);
  const result = payload.result?.result;
  if (!Array.isArray(result)) throw new Error(`NEAR view ${method}: missing result bytes`);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(result))) as T; }
  catch { throw new Error(`NEAR view ${method}: invalid JSON result`); }
}
export const getInvoice = (url: string, contract: string, id: string) => viewFunction<Invoice | null>(url, contract, "get_invoice", { id });
export const listInvoices = (url: string, contract: string, from = 0, limit = 50) => viewFunction<Invoice[]>(url, contract, "list_invoices", { from_index: String(from), limit });
export const invoicesByExporter = (url: string, contract: string, acct: string) => viewFunction<Invoice[]>(url, contract, "invoices_by_exporter", { account_id: acct });
export const invoicesByBuyer = (url: string, contract: string, acct: string) => viewFunction<Invoice[]>(url, contract, "invoices_by_buyer", { account_id: acct });
export const getBuyerRecord = (url: string, contract: string, acct: string) => viewFunction<BuyerRecord | null>(url, contract, "get_buyer_record", { account_id: acct });
export const previewAdvance = (url: string, contract: string, id: string) => viewFunction<AdvancePreview>(url, contract, "preview_advance", { id });
export const getPool = (url: string, contract: string) => viewFunction<Pool>(url, contract, "get_pool");
export const getConfig = (url: string, contract: string) => viewFunction<Config>(url, contract, "get_config");
// The §6.8 scalar previews return U128 JSON strings, not display decimals.
export const previewDeposit = (url: string, contract: string, a: string) => viewFunction<string>(url, contract, "preview_deposit", { amount: a });
export const previewRedeem = (url: string, contract: string, s: string) => viewFunction<string>(url, contract, "preview_redeem", { shares: s });
export const getClaimable = (url: string, contract: string, acct: string) => viewFunction<string>(url, contract, "get_claimable", { account_id: acct });
export const listUnattributed = (url: string, contract: string) => viewFunction<StrayPayment[]>(url, contract, "list_unattributed");
export const isLpAllowed = (url: string, contract: string, acct: string) => viewFunction<boolean>(url, contract, "is_lp_allowed", { account_id: acct });
export const nowContractDay = (url: string, contract: string, id: string) => viewFunction<string | null>(url, contract, "now_contract_day", { id });
export function explorerAccount(network: NearNetwork, account: string): string | null {
  return network === "sandbox" ? null : `https://${network === "testnet" ? "testnet." : ""}nearblocks.io/address/${encodeURIComponent(account)}`;
}
export function explorerTx(network: NearNetwork, tx: string): string | null {
  return network === "sandbox" ? null : `https://${network === "testnet" ? "testnet." : ""}nearblocks.io/txns/${encodeURIComponent(tx)}`;
}
