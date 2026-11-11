import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRepayQuote, NEAR_USDC_ASSET, OneClickClient, ORIGIN_ASSETS, resolveOriginToken, STATUS_LABELS, validRefundAddress, type OneClickToken } from "../src/oneclick";
const input = { invoiceId: "TW-0042", outstandingUnits: "10000000", amountUnits: "6000000", originAsset: ORIGIN_ASSETS.Base.assetId, refundTo: `0x${"1".repeat(40)}`, recipient: "core.near", paymentRef: "intent-id", path: "A" as const };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("repayment quotes", () => {
  it("uses exact OpenAPI fields, defaults dry, and tags Path A", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-11T00:00:00Z"));
    expect(buildRepayQuote(input)).toEqual({ dry: true, swapType: "EXACT_OUTPUT", slippageTolerance: 100, originAsset: input.originAsset, destinationAsset: NEAR_USDC_ASSET, amount: "6000000", depositType: "ORIGIN_CHAIN", refundType: "ORIGIN_CHAIN", refundTo: input.refundTo, recipientType: "DESTINATION_CHAIN", recipient: "core.near", deadline: "2026-11-11T00:30:00.000Z", customRecipientMsg: JSON.stringify({ action: "repay", invoice_id: "TW-0042", payment_ref: "intent-id" }) });
  });
  it("Path B requires a relayer and omits customRecipientMsg", () => {
    expect(() => buildRepayQuote({ ...input, path: "B" })).toThrow("RELAYER_ACCOUNT_ID");
    const q = buildRepayQuote({ ...input, path: "B", relayer: "relayer.near" });
    expect(q.recipient).toBe("relayer.near"); expect(q).not.toHaveProperty("customRecipientMsg"); expect(q.dry).toBe(true);
  });
  it.each(["0", "-1", "10000001", "999999"])("rejects invalid amount %s", amountUnits => expect(() => buildRepayQuote({ ...input, amountUnits })).toThrow());
  it("accepts the exact final dust balance and honors configured min_payment", () => {
    expect(buildRepayQuote({ ...input, outstandingUnits: "5", amountUnits: "5" }).amount).toBe("5");
    expect(() => buildRepayQuote({ ...input, minPayment: "7000000" })).toThrow("min_payment");
  });
  it("maps all statuses without claiming paid", () => {
    expect(STATUS_LABELS).toEqual({ PENDING_DEPOSIT: "Waiting for deposit", KNOWN_DEPOSIT_TX: "Waiting for deposit", PROCESSING: "Processing", SUCCESS: "Delivered to invoice", INCOMPLETE_DEPOSIT: "Deposit too small", REFUNDED: "Refunded to sender", FAILED: "Failed" });
  });
});
const token = (chain: string, assetId: string): OneClickToken => ({ blockchain: chain, assetId, symbol: "USDC", decimals: 6, price: 1, priceUpdatedAt: "2026-11-11T00:00:00Z" });
describe("token resolution and address validation", () => {
  it("resolves Ethereum from blockchain + symbol and refuses missing/ambiguous assets", () => {
    const t = token("eth", "runtime-eth-id");
    expect(resolveOriginToken([t], "Ethereum")).toBe(t);
    expect(() => resolveOriginToken([], "Ethereum")).toThrow("/v0/tokens");
    expect(() => resolveOriginToken([t, { ...t, assetId: "other" }], "Ethereum")).toThrow("ambiguous");
    const base = token("base", ORIGIN_ASSETS.Base.assetId);
    expect(resolveOriginToken([base, token("base", "other")], "Base")).toBe(base);
  });
  it("validates EVM and 32-byte Solana base58 addresses", () => {
    expect(validRefundAddress("Base", input.refundTo)).toBe(true);
    expect(validRefundAddress("Ethereum", "0x123")).toBe(false);
    expect(validRefundAddress("Solana", "1".repeat(32))).toBe(true);
    expect(validRefundAddress("Solana", "0".repeat(32))).toBe(false);
    expect(validRefundAddress("Solana", "1".repeat(44))).toBe(false);
  });
});
describe("fetch-only client", () => {
  it("uses bearer auth, defaults dry even when omitted, and sends both paths correctly", async () => {
    const mock = vi.fn().mockResolvedValue(new Response("{}"));
    const api = new OneClickClient("https://oneclick.invalid/", "test-token", mock);
    const req: Parameters<OneClickClient["quote"]>[0] = buildRepayQuote(input);
    delete req.dry;
    await api.quote(req);
    expect(JSON.parse(mock.mock.calls[0][1].body).dry).toBe(true);
    expect(mock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-token");
    mock.mockResolvedValue(new Response("{}"));
    await api.quote(buildRepayQuote({ ...input, path: "B", relayer: "relayer.near", dry: false }));
    expect(JSON.parse(mock.mock.calls[1][1].body)).toMatchObject({ recipient: "relayer.near", dry: false });
  });
  it("encodes status memo, submits exact field names, gets tokens and surfaces API messages", async () => {
    const mock = vi.fn().mockImplementation(async () => new Response("{}"));
    const api = new OneClickClient("https://oneclick.invalid", undefined, mock);
    await api.status("address/+", "memo &");
    expect(mock.mock.calls[0][0]).toBe("https://oneclick.invalid/v0/status?depositAddress=address%2F%2B&depositMemo=memo+%26");
    await api.submitDeposit({ txHash: "hash", depositAddress: "address", memo: "memo" });
    expect(JSON.parse(mock.mock.calls[1][1].body)).toEqual({ txHash: "hash", depositAddress: "address", memo: "memo" });
    await api.getTokens(); expect(mock.mock.calls[2][0]).toContain("/v0/tokens");
    mock.mockResolvedValue(new Response(JSON.stringify({ message: "Amount below swap minimum" }), { status: 400 }));
    await expect(api.quote(buildRepayQuote(input))).rejects.toThrow("Amount below swap minimum");
  });
});
