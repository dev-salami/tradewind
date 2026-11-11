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

export interface RpcBlock { header: { height: number; hash: string; prev_height?: number; timestamp_nanosec: string }; chunks: { chunk_hash: string; height_included: number }[] }
export interface RpcChunk { transactions: { hash: string; signer_id: string; receiver_id: string }[]; receipts: { receipt_id: string; receiver_id: string }[] }
export interface RpcOutcome { id: string; block_hash: string; outcome: { executor_id: string; logs: string[]; status: Record<string, unknown> } }
export interface RpcTxStatus { final_execution_status: string; transaction: { hash: string; signer_id: string }; transaction_outcome: RpcOutcome; receipts_outcome: RpcOutcome[] }
export class RpcReadError extends Error {
  constructor(public readonly detail: unknown) { super(`NEAR read failed: ${JSON.stringify(detail)}`); }
}
const cooldown = new Map<string, number>();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** Read-only methods only. A shared per-endpoint cooldown also guards concurrent 429 retries. */
export async function chainRpc<T>(url: string, method: "block" | "chunk" | "EXPERIMENTAL_tx_status" | "query", params: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const wait = (cooldown.get(url) ?? 0) - Date.now();
    if (wait > 0) await delay(wait);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "chain-read", method, params }), signal: AbortSignal.timeout(15_000) });
      if (response.status === 429) {
        const header = response.headers.get("retry-after");
        const seconds = Number(header);
        const retry = header && !Number.isFinite(seconds) ? Date.parse(header) - Date.now() : seconds * 1000;
        cooldown.set(url, Date.now() + Math.min(60_000, Math.max(250 * 2 ** attempt, retry || 0)));
      }
      if (!response.ok) {
        if (response.status !== 429 && response.status < 500) throw new RpcReadError({ http: response.status });
        throw new Error(`NEAR RPC HTTP ${response.status}`);
      }
      const body = await response.json() as { result?: T; error?: unknown };
      if (body.error) {
        const detail = JSON.stringify(body.error);
        if (/TOO_MANY_REQUESTS|rate.?limit|too many requests/i.test(detail)) {
          cooldown.set(url, Date.now() + 250 * 2 ** attempt);
          throw new Error(`NEAR RPC rate limited: ${detail}`);
        }
        if (/TIMEOUT_ERROR|INTERNAL_ERROR/.test(detail)) throw new Error(`Transient NEAR RPC error: ${detail}`);
        throw new RpcReadError(body.error);
      }
      if (body.result === undefined) throw new Error("Missing RPC result");
      return body.result;
    } catch (error) {
      if (error instanceof RpcReadError || attempt >= 3) throw error;
      await delay(250 * 2 ** attempt);
    }
  }
}
export const block = (url: string, at: "final" | "optimistic" | number | { block_id: string }) => chainRpc<RpcBlock>(url, "block", typeof at === "object" ? at : typeof at === "number" ? { block_id: at } : { finality: at });
export const chunk = (url: string, chunk_hash: string) => chainRpc<RpcChunk>(url, "chunk", { chunk_id: chunk_hash });
export const txStatus = (url: string, hash: string, sender: string) => chainRpc<RpcTxStatus>(url, "EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" });
/** Historical view, deliberately separate from the current-state viewFunction API. */
export async function poolAtBlock(url: string, contract: string, height: number): Promise<Pool> {
  const value = await chainRpc<{ result: number[] }>(url, "query", { request_type: "call_function", block_id: height, account_id: contract, method_name: "get_pool", args_base64: "e30=" });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(value.result))) as Pool;
}
