/** 1Click transport only: never signs or sends funds. */
export const NEAR_USDC_ASSET = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const ORIGIN_ASSETS = {
  Base: { blockchain: "base", assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near" },
  Arbitrum: { blockchain: "arb", assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near" },
  Solana: { blockchain: "sol", assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near" },
  Ethereum: { blockchain: "eth", assetId: null }, // check /v0/tokens at runtime
} as const;
export type OriginChain = keyof typeof ORIGIN_ASSETS;
export interface OneClickToken { assetId: string; blockchain: string; symbol: string; decimals: number; price: number; priceUpdatedAt: string; contractAddress?: string }
export interface QuoteRequest {
  dry: boolean; swapType: "EXACT_OUTPUT"; slippageTolerance: number; originAsset: string;
  depositType: "ORIGIN_CHAIN"; destinationAsset: string; amount: string; refundTo: string;
  refundType: "ORIGIN_CHAIN"; recipient: string; recipientType: "DESTINATION_CHAIN";
  deadline: string; customRecipientMsg?: string;
}
export interface OneClickQuote {
  amountIn: string; amountInFormatted: string; minAmountIn: string; amountOut: string;
  amountOutFormatted: string; amountInUsd: string; amountOutUsd: string; minAmountOut: string;
  timeEstimate: number; depositAddress?: string; depositMemo?: string; deadline?: string;
  refundFee?: string; withdrawFee?: string;
}
export interface QuoteResponse { correlationId: string; timestamp: string; signature: string; quoteRequest: QuoteRequest; quote: OneClickQuote }
export type OneClickStatus = "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "PROCESSING" | "SUCCESS" | "INCOMPLETE_DEPOSIT" | "REFUNDED" | "FAILED";
export interface ExecutionStatus {
  correlationId: string; quoteResponse: QuoteResponse; status: OneClickStatus; updatedAt: string;
  swapDetails: { intentHashes: string[]; nearTxHashes: string[]; originChainTxHashes: { hash: string; explorerUrl: string }[]; destinationChainTxHashes: { hash: string; explorerUrl: string }[]; refundReason?: string };
}
export const STATUS_LABELS: Record<OneClickStatus, string> = {
  PENDING_DEPOSIT: "Waiting for deposit", KNOWN_DEPOSIT_TX: "Waiting for deposit", PROCESSING: "Processing",
  SUCCESS: "Delivered to invoice", INCOMPLETE_DEPOSIT: "Deposit too small", REFUNDED: "Refunded to sender", FAILED: "Failed",
};
export function resolveOriginToken(tokens: OneClickToken[], chain: OriginChain): OneClickToken {
  const preset = ORIGIN_ASSETS[chain];
  const matches = tokens.filter(t => t.blockchain === preset.blockchain && t.symbol === "USDC" && (!preset.assetId || t.assetId === preset.assetId));
  if (matches.length !== 1) throw new Error("USDC asset unavailable or ambiguous — check /v0/tokens");
  return matches[0];
}
export function validRefundAddress(chain: OriginChain, address: string): boolean {
  if (chain !== "Solana") return /^0x[0-9a-fA-F]{40}$/.test(address);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return false;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of address) n = n * 58n + BigInt(alphabet.indexOf(c));
  let bytes = 0;
  while (n > 0n) { bytes++; n >>= 8n; }
  return bytes + (address.match(/^1*/)?.[0].length ?? 0) === 32;
}
export function validateRepayAmount(amount: bigint, outstanding: bigint, minPayment: bigint = 1_000_000n) {
  if (amount <= 0n || amount > outstanding) throw new Error("Payment must be positive and not exceed outstanding");
  if (amount < minPayment && amount !== outstanding) throw new Error("Payment is below min_payment; pay the final balance exactly instead");
}
export function buildRepayQuote(input: {
  invoiceId: string; outstandingUnits: bigint | string; amountUnits: bigint | string;
  minPayment?: bigint | string; originAsset: string; refundTo: string; recipient: string;
  paymentRef: string; path: "A" | "B"; relayer?: string; dry?: boolean; deadlineMinutes?: number;
}): QuoteRequest {
  validateRepayAmount(BigInt(input.amountUnits), BigInt(input.outstandingUnits), BigInt(input.minPayment ?? 1_000_000));
  if (input.path === "B" && !input.relayer) throw new Error("Path B requires RELAYER_ACCOUNT_ID");
  const minutes = input.deadlineMinutes ?? 30;
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("Invalid quote deadline");
  return {
    dry: input.dry ?? true, swapType: "EXACT_OUTPUT", amount: String(input.amountUnits),
    destinationAsset: NEAR_USDC_ASSET, originAsset: input.originAsset,
    depositType: "ORIGIN_CHAIN", refundType: "ORIGIN_CHAIN", refundTo: input.refundTo,
    recipientType: "DESTINATION_CHAIN", recipient: input.path === "A" ? input.recipient : input.relayer!,
    slippageTolerance: 100, deadline: new Date(Date.now() + minutes * 60_000).toISOString(),
    ...(input.path === "A" ? { customRecipientMsg: JSON.stringify({ action: "repay", invoice_id: input.invoiceId, payment_ref: input.paymentRef }) } : {}),
  };
}
export class OneClickClient {
  constructor(private baseUrl = "https://1click.chaindefuser.com", private jwt?: string, private fetcher: typeof fetch = fetch) {}
  private async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method: body === undefined ? "GET" : "POST", cache: "no-store", signal: AbortSignal.timeout(20_000),
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(this.jwt ? { Authorization: `Bearer ${this.jwt}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.message === "string" ? result.message : `1Click error (${response.status})`);
    return result as T;
  }
  getTokens() { return this.request<OneClickToken[]>("/v0/tokens"); }
  quote(req: Omit<QuoteRequest, "dry"> & { dry?: boolean }) { return this.request<QuoteResponse>("/v0/quote", { ...req, dry: req.dry ?? true }); }
  status(depositAddress: string, depositMemo?: string) {
    const query = new URLSearchParams({ depositAddress });
    if (depositMemo !== undefined) query.set("depositMemo", depositMemo);
    return this.request<ExecutionStatus>(`/v0/status?${query}`);
  }
  submitDeposit(input: { txHash: string; depositAddress: string; memo?: string }) { return this.request<ExecutionStatus>("/v0/deposit/submit", input); }
}
