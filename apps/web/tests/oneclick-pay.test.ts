// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureConfig, getConfig, getInvoice, makeFixtures, NEAR_USDC_ASSET, ORIGIN_ASSETS, viewFunction, type Invoice } from "@tradewind/core";
import * as db from "../src/server/db";
import { POST as quotePost } from "../src/app/api/pay/[id]/quote/route";
import { POST as simulatePost } from "../src/app/api/pay/[id]/simulate/route";
import { POST as depositPost } from "../src/app/api/pay/intents/[pid]/deposit-tx/route";
import { GET as statusGet } from "../src/app/api/pay/intents/[pid]/status/route";
import { invoiceIntents } from "../src/server/pay";
vi.mock("@tradewind/core", async importOriginal => ({ ...await importOriginal<typeof import("@tradewind/core")>(), getConfig: vi.fn(), getInvoice: vi.fn(), viewFunction: vi.fn() }));
let repo: ReturnType<typeof db.repository>, invoice: Invoice, ip = 0;
const fetchMock = vi.fn();
const address = `0x${"1".repeat(40)}`;
const body = { originAsset: ORIGIN_ASSETS.Base.assetId, refundTo: address };
const context = { params: Promise.resolve({ id: "TW-0042" }) };
function request(value: unknown = body, origin = "http://localhost:3000", hostIp = String(++ip)) {
  return new Request("http://localhost:3000/api/pay/TW-0042/quote", { method: "POST", headers: { origin, "Content-Type": "application/json", "x-forwarded-for": hostIp }, body: JSON.stringify(value) });
}
function quoteCalls() { return fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v0/quote")).map(([, init]) => JSON.parse(init.body)); }
beforeEach(() => {
  vi.stubEnv("NEAR_NETWORK", "mainnet"); vi.stubEnv("ONECLICK_LIVE_QUOTES", "0"); vi.stubEnv("SETTLEMENT_PATH", "A");
  vi.stubEnv("PUBLIC_BASE_URL", "http://localhost:3000"); vi.stubEnv("USDC_CONTRACT_ID", NEAR_USDC_ASSET.slice(7));
  vi.stubEnv("CORE_CONTRACT_ID", "core.near"); vi.stubEnv("ONECLICK_BASE_URL", "https://oneclick.invalid");
  repo = db.repository(":memory:"); vi.spyOn(db, "store").mockReturnValue(repo);
  invoice = makeFixtures().invoices.find(i => i.id === "TW-0042")!;
  vi.mocked(getInvoice).mockImplementation(async () => invoice); vi.mocked(getConfig).mockResolvedValue(fixtureConfig); vi.mocked(viewFunction).mockResolvedValue({ total: "1" });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v0/tokens")) return Response.json([{ assetId: body.originAsset, blockchain: "base", symbol: "USDC", decimals: 6 }]);
    if (url.endsWith("/v0/quote")) {
      const req = JSON.parse(String(init?.body));
      return Response.json({ correlationId: "correlation", signature: "signature", timestamp: "2026-11-11T00:00:00Z", quoteRequest: req, quote: { amountIn: "10100000", minAmountIn: "10000000", amountInFormatted: "10.1", amountOut: req.amount, timeEstimate: 120, depositAddress: address, depositMemo: "123", deadline: req.deadline } });
    }
    return Response.json({ status: "SUCCESS", swapDetails: { nearTxHashes: ["near-tx"], originChainTxHashes: [{ hash: "origin-tx", explorerUrl: "https://untrusted.invalid" }], destinationChainTxHashes: [], intentHashes: [] } });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { repo.db.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("safe payment API", () => {
  it("refuses simulator mode on mainnet before any upstream calls", async () => {
    vi.stubEnv("ONECLICK_SIMULATOR", "1");
    const response = await quotePost(request({ ...body, live: true }), context);
    expect(response.status).toBe(403); expect((await response.json()).error).toContain("refused on mainnet"); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("persists a non-dry simulated Path B intent against the local fake only", async () => {
    vi.stubEnv("ONECLICK_SIMULATOR", "1"); vi.stubEnv("NEAR_NETWORK", "sandbox"); vi.stubEnv("ONECLICK_BASE_URL", "http://127.0.0.1:4444");
    vi.stubEnv("SETTLEMENT_PATH", "B"); vi.stubEnv("RELAYER_ACCOUNT_ID", "relayer.test.near"); vi.stubEnv("USDC_CONTRACT_ID", "usdc.test.near");
    const response = await quotePost(request({ ...body, live: true }), context), result = await response.json();
    expect(response.status).toBe(200); expect(result).toMatchObject({ simulated: true, dry: false, path: "B", preview: true });
    expect(quoteCalls()[0]).toMatchObject({ recipient: "relayer.test.near", dry: false });
    expect(repo.db.prepare("SELECT path, network FROM payment_intents WHERE pid=?").get(result.pid)).toEqual({ path: "B", network: "sandbox" });
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("http://127.0.0.1:4444/"))).toBe(true);
  });
  it("simulator refuses a non-local upstream and still honors dry override", async () => {
    vi.stubEnv("ONECLICK_SIMULATOR", "1"); vi.stubEnv("NEAR_NETWORK", "sandbox");
    expect((await quotePost(request({ ...body, live: true }), context)).status).toBe(503); expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("ONECLICK_BASE_URL", "http://localhost:4444");
    const original = request({ ...body, live: true });
    const result = await (await quotePost(new Request(`${original.url}?dry=1`, { method: "POST", headers: original.headers, body: await original.text() }), context)).json();
    expect(result).toMatchObject({ simulated: true, dry: true }); expect(result.pid).toBeUndefined();
  });
  it.each([undefined, false, true])("every quote stays dry without the env flag (live=%s)", async live => {
    const r = await quotePost(request({ ...body, live }), context), result = await r.json();
    expect(r.status).toBe(200); expect(result.dry).toBe(true); expect(result).not.toHaveProperty("depositAddress"); expect(result).not.toHaveProperty("depositMemo"); expect(result).not.toHaveProperty("pid");
    expect(quoteCalls()).toHaveLength(1); expect(quoteCalls().every(q => q.dry === true)).toBe(true);
    expect(repo.db.prepare("SELECT count(*) AS n FROM payment_intents").get()?.n).toBe(0);
  });
  it("an enabled flag alone still requests a dry quote", async () => {
    vi.stubEnv("ONECLICK_LIVE_QUOTES", "1");
    expect((await (await quotePost(request(), context)).json()).dry).toBe(true);
    expect(quoteCalls()[0].dry).toBe(true);
  });
  it("the dry query override wins over the live flag and action", async () => {
    vi.stubEnv("ONECLICK_LIVE_QUOTES", "1");
    const original = request({ ...body, live: true });
    const forced = new Request(`${original.url}?dry=1`, { method: "POST", headers: original.headers, body: await original.text() });
    expect((await (await quotePost(forced, context)).json()).dry).toBe(true);
    expect(quoteCalls()[0].dry).toBe(true);
  });
  it.each(["testnet", "sandbox"])("forces %s to preview even with live flag + action", async net => {
    vi.stubEnv("NEAR_NETWORK", net); vi.stubEnv("ONECLICK_LIVE_QUOTES", "1");
    const result = await (await quotePost(request({ ...body, live: true }), context)).json();
    expect(result).toMatchObject({ dry: true, preview: true }); expect(result).not.toHaveProperty("depositAddress"); expect(quoteCalls()[0].dry).toBe(true);
  });
  it("creates a persisted live intent only for flag + explicit live action, with pid in the message", async () => {
    vi.stubEnv("ONECLICK_LIVE_QUOTES", "1");
    const r = await quotePost(request({ ...body, live: true }), context), result = await r.json();
    expect(r.status).toBe(200); expect(result).toMatchObject({ dry: false, preview: false, depositAddress: address, depositMemo: "123" });
    expect(quoteCalls()[0].dry).toBe(false); expect(JSON.parse(quoteCalls()[0].customRecipientMsg).payment_ref).toBe(result.pid);
    const row = repo.db.prepare("SELECT * FROM payment_intents WHERE pid = ?").get(result.pid)!;
    expect(row.payment_ref).toBe(result.pid); expect(row.amount_out_e6).toBe("10000000"); expect(JSON.parse(String(row.quote_json)).signature).toBe("signature");
    expect(invoiceIntents(invoice.id).intents).toHaveLength(1);
  });
  it("requires recipient USDC registration before a real quote", async () => {
    vi.stubEnv("ONECLICK_LIVE_QUOTES", "1"); vi.mocked(viewFunction).mockResolvedValue(null);
    expect((await quotePost(request({ ...body, live: true }), context)).status).toBe(503);
    expect(quoteCalls()).toHaveLength(0);
  });
  it("supports Path B but never forwards funds or claims invoice settlement from SUCCESS alone", async () => {
    vi.stubEnv("ONECLICK_LIVE_QUOTES", "1"); vi.stubEnv("SETTLEMENT_PATH", "B"); vi.stubEnv("RELAYER_ACCOUNT_ID", "relayer.near");
    const result = await (await quotePost(request({ ...body, live: true }), context)).json();
    expect(quoteCalls()[0]).toMatchObject({ recipient: "relayer.near" }); expect(quoteCalls()[0]).not.toHaveProperty("customRecipientMsg");
    const c = { params: Promise.resolve({ pid: result.pid }) };
    const status = await (await statusGet(new Request("http://localhost:3000"), c)).json();
    expect(status.settlement.confirmed).toBe(false); expect(status.label).toContain("awaiting invoice settlement");
    invoice.payments.push({ amount: invoice.face, at: invoice.created_at, sender: "relayer.near", payment_ref: result.pid });
    expect((await (await statusGet(new Request("http://localhost:3000"), c)).json()).settlement.confirmed).toBe(true);
    const hash = "a".repeat(64);
    await depositPost(request({ txHash: hash }), c);
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/v0/deposit/submit"))!;
    expect(JSON.parse(call[1].body)).toEqual({ txHash: hash, depositAddress: address, memo: "123" });
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("https://oneclick.invalid/"))).toBe(true);
  });
  it("uses outstanding net of overpaid and allows only exact final dust below the minimum", async () => {
    invoice.paid.total = "10500000"; invoice.paid.overpaid = "1000000"; // net paid 9.5; due .5
    const r = await quotePost(request(), context);
    expect(r.status).toBe(200); expect(quoteCalls()[0].amount).toBe("500000");
    for (const amount of ["0", "1", "500001"]) expect((await quotePost(request({ ...body, amount }), context)).status).toBe(400);
    expect(quoteCalls()).toHaveLength(1);
  });
  it("rejects bad addresses, non-payable invoices and cross-origin mutations", async () => {
    expect((await quotePost(request({ ...body, refundTo: "bad" }), context)).status).toBe(400);
    invoice.status = "Created"; expect((await quotePost(request(), context)).status).toBe(400);
    expect((await quotePost(request(body, "https://elsewhere.invalid"), context)).status).toBe(403);
    expect(quoteCalls()).toHaveLength(0);
  });
  it("limits quotes to ten/minute/IP", async () => {
    const key = `limited-${++ip}`;
    for (let n = 0; n < 10; n++) expect((await quotePost(request(body, undefined, key), context)).status).toBe(200);
    expect((await quotePost(request(body, undefined, key), context)).status).toBe(429);
  });
  it("returns 1Click's error message as JSON", async () => {
    fetchMock.mockImplementation(async () => Response.json({ message: "Quote amount below swap minimum" }, { status: 400 }));
    const r = await quotePost(request(), context);
    expect(await r.json()).toEqual({ error: "Quote amount below swap minimum" });
  });
  it("simulator is testnet-only, scripted for six seconds, never settles and makes no calls", async () => {
    expect((await simulatePost(request({}))).status).toBe(403);
    vi.stubEnv("NEAR_NETWORK", "testnet");
    const r = await simulatePost(request({})), s = await r.json();
    expect(s).toMatchObject({ simulated: true, preview: true, settlement: { confirmed: false } });
    expect(s.steps).toEqual([{ afterMs: 0, status: "PENDING_DEPOSIT" }, { afterMs: 3000, status: "PROCESSING" }, { afterMs: 6000, status: "SUCCESS" }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("migrations are repeatable and preserve existing rows", () => {
    repo.putAccount("sample.near", "buyer", "Sample", ""); db.migrate(repo.db); db.migrate(repo.db);
    expect(repo.getAccount("sample.near")).toMatchObject({ display_name: "Sample" });
  });
});
