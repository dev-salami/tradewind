import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { buildRepayQuote, getConfig, getInvoice, NEAR_USDC_ASSET, OneClickClient, ORIGIN_ASSETS, resolveOriginToken, STATUS_LABELS, validRefundAddress, validateRepayAmount, viewFunction, type OriginChain } from "@tradewind/core";
import { env } from "./env";
import { store } from "./db";
import { ApiError } from "./errors";
import { assertSameOrigin } from "./auth/session";

// Fixed windows enforce at most ten quotes in a minute per trusted ingress IP.
const windows = new Map<string, { at: number; count: number }>();
function rateLimit(request: Request) {
  const now = Date.now();
  for (const [key, w] of windows) if (now - w.at >= 60_000) windows.delete(key);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const w = windows.get(ip) ?? { at: now, count: 0 };
  windows.set(ip, w);
  if (++w.count > 10) throw new ApiError("Quote limit reached; retry in a minute", 429);
}
export function liveQuotesAllowed() { const e = env(); return e.NEAR_NETWORK === "mainnet" && e.ONECLICK_LIVE_QUOTES === "1"; }
const client = () => { const e = env(); return new OneClickClient(e.ONECLICK_BASE_URL, e.ONECLICK_JWT); };
const quoteBody = z.object({ originAsset: z.string().min(1).max(250), amount: z.string().regex(/^\d{1,39}$/).optional(), refundTo: z.string().min(1).max(100), live: z.boolean().optional() }).strict();
const payable = ["Accepted", "Funded", "PartiallyPaid", "Defaulted"];
export async function quotePayment(request: Request, id: string) {
  assertSameOrigin(request); rateLimit(request);
  const body = quoteBody.parse(await request.json());
  const e = env(), api = client();
  const [invoice, config] = await Promise.all([getInvoice(e.NEAR_RPC_URL, e.CORE_CONTRACT_ID, id), getConfig(e.NEAR_RPC_URL, e.CORE_CONTRACT_ID)]);
  if (!invoice) throw new ApiError("Invoice not found", 404);
  if (!payable.includes(invoice.status)) throw new ApiError("Invoice is not payable");
  const outstanding = BigInt(invoice.face) - (BigInt(invoice.paid.total) - BigInt(invoice.paid.overpaid));
  try { validateRepayAmount(BigInt(body.amount ?? outstanding), outstanding, BigInt(config.min_payment)); }
  catch (error) { throw new ApiError(error instanceof Error ? error.message : "Invalid amount"); }
  // Resolve only supported USDC origin assets, including Ethereum's runtime asset id.
  const tokens = await api.getTokens();
  const chain = (Object.keys(ORIGIN_ASSETS) as OriginChain[]).find(c => {
    try { return resolveOriginToken(tokens, c).assetId === body.originAsset || c === body.originAsset; } catch { return false; }
  });
  if (!chain) throw new ApiError("Unsupported origin asset — check /v0/tokens");
  const token = resolveOriginToken(tokens, chain);
  if (!validRefundAddress(chain, body.refundTo)) throw new ApiError(`Invalid ${chain} refund address`);
  const dry = !(liveQuotesAllowed() && body.live === true && new URL(request.url).searchParams.get("dry") !== "1");
  const pid = randomUUID();
  const req = buildRepayQuote({ invoiceId: id, outstandingUnits: outstanding, amountUnits: body.amount ?? outstanding.toString(), minPayment: config.min_payment, originAsset: token.assetId, refundTo: body.refundTo, recipient: e.CORE_CONTRACT_ID, paymentRef: pid, path: e.SETTLEMENT_PATH, relayer: e.RELAYER_ACCOUNT_ID, dry });
  if (!dry) {
    if (`nep141:${e.USDC_CONTRACT_ID}` !== NEAR_USDC_ASSET) throw new ApiError("Live quotes require mainnet USDC configuration", 503);
    const storage = await viewFunction(e.NEAR_RPC_URL, e.USDC_CONTRACT_ID, "storage_balance_of", { account_id: req.recipient });
    if (!storage) throw new ApiError("Recipient must be storage-registered on USDC before live quotes", 503);
  }
  const result = await api.quote(req), q = result.quote;
  if (!dry) {
    if (!q.depositAddress || !q.deadline) throw new ApiError("1Click returned no deposit address or deadline", 502);
    store().db.prepare(`INSERT INTO payment_intents (pid, payment_ref, network, invoice_id, origin_asset, amount_out_e6, amount_in, deposit_address, deposit_memo, refund_to, deadline, path, oneclick_status, quote_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(pid, pid, e.NEAR_NETWORK, id, token.assetId, req.amount, q.amountIn, q.depositAddress, q.depositMemo ?? null, body.refundTo, q.deadline, e.SETTLEMENT_PATH, "PENDING_DEPOSIT", JSON.stringify(result), Date.now());
  }
  return { ...(dry ? {} : { pid }), dry, preview: e.NEAR_NETWORK !== "mainnet", amountIn: q.amountIn, amountInFormatted: q.amountInFormatted, minAmountIn: q.minAmountIn,
    ...(dry ? {} : { depositAddress: q.depositAddress, depositMemo: q.depositMemo }), deadline: dry ? req.deadline : q.deadline,
    timeEstimate: q.timeEstimate, path: e.SETTLEMENT_PATH, amountOut: req.amount, refundFee: q.refundFee, withdrawFee: q.withdrawFee,
    // Preserve the signed quote for dispute records only for real deposits.
    ...(dry ? {} : { quoteResponse: result }),
  };
}
interface Intent { pid: string; invoice_id: string; deposit_address: string; deposit_memo: string | null; network: string; path: string }
function intent(pid: string): Intent {
  const row = store().db.prepare("SELECT * FROM payment_intents WHERE pid = ? AND network = ?").get(pid, env().NEAR_NETWORK) as unknown as Intent | undefined;
  if (!row) throw new ApiError("Payment intent not found", 404);
  return row;
}
export async function depositTransaction(request: Request, pid: string) {
  assertSameOrigin(request);
  const { txHash } = z.object({ txHash: z.string().regex(/^[A-Za-z0-9]{32,128}$/) }).strict().parse(await request.json());
  const row = intent(pid);
  const result = await client().submitDeposit({ txHash, depositAddress: row.deposit_address, ...(row.deposit_memo === null ? {} : { memo: row.deposit_memo }) });
  store().db.prepare("UPDATE payment_intents SET origin_tx = ?, oneclick_status = ? WHERE pid = ?").run(txHash, result.status, pid);
  return { status: result.status };
}
export async function paymentStatus(pid: string) {
  const row = intent(pid), e = env();
  const [result, invoice] = await Promise.all([client().status(row.deposit_address, row.deposit_memo ?? undefined), getInvoice(e.NEAR_RPC_URL, e.CORE_CONTRACT_ID, row.invoice_id)]);
  const payment = invoice?.payments.find(p => p.payment_ref === pid);
  const nearTx = result.swapDetails.nearTxHashes.at(-1) ?? null;
  store().db.prepare("UPDATE payment_intents SET oneclick_status = ?, near_tx = ?, origin_tx = COALESCE(?, origin_tx) WHERE pid = ?").run(result.status, nearTx, result.swapDetails.originChainTxHashes.at(-1)?.hash ?? null, pid);
  const confirmed = result.status === "SUCCESS" && !!payment;
  return { status: result.status, label: result.status === "SUCCESS" && !payment ? "Delivered on NEAR — awaiting invoice settlement" : STATUS_LABELS[result.status],
    settlement: { confirmed, payment: payment ?? null }, path: row.path, swapDetails: result.swapDetails };
}
/** Read-only reconciliation surface; no worker or signing capability here. */
export function invoiceIntents(id: string) {
  return { intents: store().db.prepare("SELECT pid, payment_ref, invoice_id, origin_asset, amount_out_e6, amount_in, deposit_address, deposit_memo, deadline, path, oneclick_status, origin_tx, near_tx, settled_tx, created_at FROM payment_intents WHERE invoice_id = ? AND network = ? ORDER BY created_at").all(id, env().NEAR_NETWORK) };
}
export function simulatePayment(request: Request) {
  assertSameOrigin(request);
  if (env().NEAR_NETWORK === "mainnet") throw new ApiError("Simulator is testnet only", 403);
  return { preview: true, simulated: true, settlement: { confirmed: false }, steps: [
    { afterMs: 0, status: "PENDING_DEPOSIT" }, { afterMs: 3000, status: "PROCESSING" }, { afterMs: 6000, status: "SUCCESS" },
  ], explanation: 'Simulation only — no funds moved or invoice settlement. Actual testnet repayment is done via "Pay on NEAR (testnet USDC)".' };
}
export async function payResponse(action: () => unknown | Promise<unknown>) {
  try { return Response.json(await action(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof z.ZodError ? "Invalid payment request" : error instanceof Error ? error.message : "Payment service unavailable" }, { status: error instanceof ApiError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 502 }); }
}
