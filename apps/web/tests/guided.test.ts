// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as invoicePost } from "../src/app/api/guided/invoice/route";
import { POST as acceptPost } from "../src/app/api/guided/accept/route";
import { POST as advancePost } from "../src/app/api/guided/advance/route";
import { POST as payPost } from "../src/app/api/guided/pay/route";
import { POST as statusPost } from "../src/app/api/guided/status/route";
import { withAccountLock } from "../src/server/guided/signer";
import { samplePdf } from "../src/server/guided/sample-pdf";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { encryptGuidedKey, migrateGuided, signGuidedSession } from "../src/server/guided/session-store";

const mocks = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined, create: vi.fn(), call: vi.fn(), view: vi.fn(), key: vi.fn(), connect: vi.fn(), audit: vi.fn(), putTx: vi.fn(), putVerification: vi.fn(), verify: vi.fn() }));
vi.mock("near-api-js", () => ({
  Account: class {
    constructor(_connection: unknown, readonly id: string) {}
    get accountId() { return this.id; }
    functionCall(args: unknown) { return mocks.call(this.id, args); }
    viewFunction(args: unknown) { return mocks.view(this.id, args); }
    createAccount(...args: unknown[]) { return mocks.create(...args); }
  },
  KeyPair: { fromString: (value: string) => ({ toString: () => value, getPublicKey: () => "test-public-key" }), fromRandom: () => ({ toString: () => "test-private-key", getPublicKey: () => "test-public-key" }) },
  utils: { format: { parseNearAmount: () => "500000000000000000000000" } },
  keyStores: { InMemoryKeyStore: class { setKey(...args: unknown[]) { return mocks.key(...args); } } },
  connect: mocks.connect,
}));
vi.mock("../src/server/db", () => ({ store: () => ({ db: mocks.db!, audit: mocks.audit, putTx: mocks.putTx, putVerification: mocks.putVerification }) }));
vi.mock("../src/server/nearai/verify-flow", () => ({ runVerification: mocks.verify }));

const routes = [invoicePost, acceptPost, advancePost, payPost, statusPost];
const exporter = "sample-exporter.testnet", buyer = "sample-buyer.testnet";
const session = "a".repeat(32);
const invoice = { id: "TW-0042", exporter, buyer, status: "Verified", terms_hash: "a".repeat(64), face: "10000000", paid: { total: "0", overpaid: "0" } };
const proof = { verdict: "pass", mock: true, verified_ok: false, model_id: "mock/sample-parser", request_hash: "b".repeat(64), response_hash: "c".repeat(64), signature: "MOCK-NOT-A-SIGNATURE", signing_address: "mock", signing_algo: "mock", chat_id: "mock-chat" };
let ip = 0;
function request(body: unknown = {}, address = `192.0.2.${++ip}`) {
  return new Request("http://localhost/api/guided", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "x-forwarded-for": address, cookie: `tw_guided=${signGuidedSession(session)}` }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-only-session-secret-at-least-32-bytes");
  mocks.db = new DatabaseSync(":memory:"); migrateGuided(mocks.db);
  mocks.db.prepare("INSERT INTO guided_sessions (session_id,buyer_account,encrypted_key,created_at,ready) VALUES (?,?,?,?,1)").run(session, buyer, encryptGuidedKey("test-only-buyer"), Date.now());
  vi.stubEnv("NEAR_NETWORK", "testnet"); vi.stubEnv("AI_MODE", "mock"); vi.stubEnv("PUBLIC_BASE_URL", "http://localhost");
  vi.stubEnv("GUIDED_ENABLED", "1"); vi.stubEnv("GUIDED_EXPORTER_ACCOUNT_ID", exporter); vi.stubEnv("GUIDED_BUYER_ACCOUNT_ID", buyer);
  vi.stubEnv("GUIDED_EXPORTER_PRIVATE_KEY", "test-only-exporter"); vi.stubEnv("GUIDED_BUYER_PRIVATE_KEY", "test-only-buyer");
  vi.stubEnv("ATTESTER_ACCOUNT_ID", "attester.testnet"); vi.stubEnv("ATTESTER_PRIVATE_KEY", "test-only-attester");
  vi.stubEnv("CORE_CONTRACT_ID", "core.testnet"); vi.stubEnv("USDC_CONTRACT_ID", "usdc.testnet");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in guided tests"); }));
  mocks.connect.mockResolvedValue({ connection: {} }); mocks.key.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({});
  mocks.verify.mockResolvedValue(proof);
  mocks.call.mockImplementation(async (_account, call) => ({ transaction: { hash: `${call.methodName}-hash` }, status: { SuccessValue: Buffer.from(JSON.stringify(invoice)).toString("base64") } }));
  mocks.view.mockImplementation(async (_account, call) => {
    if (call.methodName === "get_invoice") return invoice;
    if (call.methodName === "preview_advance") return { eligible: true, advance: "7000000" };
    if (call.methodName === "get_config") return { min_payment: "1000000" };
    if (call.methodName === "ft_balance_of") return "0";
    throw new Error("Unexpected view");
  });
});
afterEach(() => { mocks.db?.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("guided route safety", () => {
  it("refuses mainnet from public-only network configuration before missing keys", async () => {
    vi.stubEnv("NEAR_NETWORK", ""); vi.stubEnv("NEXT_PUBLIC_NEAR_NETWORK", "mainnet"); vi.stubEnv("GUIDED_ENABLED", "");
    expect((await statusPost(request())).status).toBe(403);
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it.each(routes)("always refuses mainnet before configuration, origin or payload checks: %s", async route => {
    vi.stubEnv("NEAR_NETWORK", "mainnet"); vi.stubEnv("GUIDED_ENABLED", "");
    const response = await route(new Request("http://localhost", { method: "POST", body: "not json" }));
    expect(response.status).toBe(403); expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.call).not.toHaveBeenCalled();
  });
  it.each(routes)("returns sanitized 503 when keys are missing: %s", async route => {
    vi.stubEnv("GUIDED_BUYER_PRIVATE_KEY", "");
    const response = await route(request());
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ error: "guided mode not configured" });
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it("requires explicit opt-in", async () => {
    vi.stubEnv("GUIDED_ENABLED", "0"); expect((await statusPost(request())).status).toBe(503);
  });
  it.each(["GUIDED_EXPORTER_ACCOUNT_ID", "GUIDED_EXPORTER_PRIVATE_KEY", "GUIDED_BUYER_ACCOUNT_ID", "GUIDED_BUYER_PRIVATE_KEY"])("requires %s on every route", async name => {
    vi.stubEnv(name, "");
    for (const route of routes) {
      const response = await route(request());
      expect(response.status).toBe(503); expect((await response.json()).error).toBe("guided mode not configured");
    }
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it.each(routes)("requires same-origin JSON: %s", async route => {
    const crossOrigin = request(); crossOrigin.headers.set("origin", "https://other.invalid");
    expect((await route(crossOrigin)).status).toBe(403);
    const noOrigin = request(); noOrigin.headers.delete("origin"); expect((await route(noOrigin)).status).toBe(403);
    const wrongType = request(); wrongType.headers.set("content-type", "text/plain"); expect((await route(wrongType)).status).toBe(415);
    const malformed = new Request("http://localhost", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "x-forwarded-for": `bad-${++ip}` }, body: "{" });
    expect((await route(malformed)).status).toBe(400); expect(mocks.call).not.toHaveBeenCalled();
  });
  it("shares the existing token bucket across all routes, 20/min/IP", async () => {
    for (let n = 0; n < 20; n++) expect((await statusPost(request({}, "rate-test"))).status).toBe(200);
    for (const route of routes) expect((await route(request({}, "rate-test"))).status).toBe(429);
    expect((await statusPost(request({}, "another-ip"))).status).toBe(200);
  });
  it("reports only public accounts and availability in sandbox", async () => {
    vi.stubEnv("NEAR_NETWORK", "sandbox");
    const response = await statusPost(request());
    expect(await response.json()).toEqual({ available: true, network: "sandbox", exporter, buyer, tx_hashes: [], tx_links: [] });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.audit).toHaveBeenCalledWith("guided_status", "", JSON.stringify({ actor: "guided" }));
  });
  it.each([
    [invoicePost, { face: "0" }], [invoicePost, { face: 10 }], [invoicePost, { face: "1.00" }],
    [invoicePost, { face: (1n << 128n).toString() }], [invoicePost, { tenor_days: 0 }], [invoicePost, { tenor_days: 366 }],
    [invoicePost, { tenor_days: 1.5 }], [invoicePost, { buyer: "other.testnet" }], [acceptPost, {}],
    [advancePost, { invoice_id: "bad" }], [payPost, { invoice_id: invoice.id, amount: "-1" }],
    [payPost, { invoice_id: invoice.id, amount: 1 }], [statusPost, { extra: true }], [statusPost, null],
  ] as const)("validates payloads without signing", async (route, body) => {
    expect((await route(request(body))).status).toBe(400); expect(mocks.call).not.toHaveBeenCalled();
  });
  it.each([acceptPost, advancePost, payPost])("refuses invoices outside the demo pair", async route => {
    mocks.view.mockResolvedValue({ ...invoice, exporter: "other.testnet" });
    expect((await route(request({ invoice_id: invoice.id }))).status).toBe(403); expect(mocks.call).not.toHaveBeenCalled();
  });
});

describe("guided transaction methods", () => {
  it("sets a signed session cookie on the first invoice and signs subsequent acceptance as its new buyer", async () => {
    const first = request(); first.headers.delete("cookie");
    const response = await invoicePost(first);
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^tw_guided=[a-f0-9]{32}\./); expect(cookie).toContain("HttpOnly");
    const created = mocks.call.mock.calls.find(([, call]) => call.methodName === "create_invoice")![1];
    expect(created.args.buyer).toMatch(/^g[0-9a-f]{8}\.sample-buyer\.testnet$/);
    expect(created.args.invoice_number).toMatch(/^G-[0-9a-f]{8}-1$/);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    mocks.view.mockResolvedValue({ ...invoice, buyer: created.args.buyer });
    const accept = request({ invoice_id: invoice.id }); accept.headers.set("cookie", cookie.split(";")[0]);
    expect((await acceptPost(accept)).status).toBe(200);
    expect(mocks.call).toHaveBeenLastCalledWith(created.args.buyer, expect.objectContaining({ methodName: "accept_invoice" }));
  });
  it("creates from in-memory PDF, hashes before verification, and attests", async () => {
    mocks.verify.mockImplementation(async input => {
      const create = mocks.call.mock.calls.find(([, call]) => call.methodName === "create_invoice")![1];
      expect(create.args.doc_hash).toBe(createHash("sha256").update(input.pdfBytes).digest("hex"));
      expect(input.pdfBytes.slice(0, 4)).toEqual(new Uint8Array([37, 80, 68, 70]));
      expect(input.formFields).toMatchObject({ face: "10000000", tenor_days: 60, buyer, exporter });
      return proof;
    });
    const response = await invoicePost(request()); expect(response.status).toBe(200);
    expect(mocks.call).toHaveBeenCalledWith(exporter, expect.objectContaining({ contractId: "core.testnet", methodName: "create_invoice", args: expect.objectContaining({ buyer, buyer_label: "Gulf Foods Trading (sample)", face: "10000000", tenor_days: 60, terms_hash: null }), attachedDeposit: 100_000_000_000_000_000_000_000n, gas: 30_000_000_000_000n }));
    expect(mocks.call).toHaveBeenCalledWith("attester.testnet", expect.objectContaining({ methodName: "record_verification", args: { id: invoice.id, v: { verdict: "pass", model_id: proof.model_id, request_hash: proof.request_hash, response_hash: proof.response_hash, signature: proof.signature, signing_address: proof.signing_address, signing_algo: proof.signing_algo, chat_id: proof.chat_id, at: "0" } }, gas: 30_000_000_000_000n, attachedDeposit: 0n }));
    expect(await response.json()).toEqual({ invoice_id: invoice.id, verdict: "pass", mock: true, tx_hashes: ["create_invoice-hash", "record_verification-hash"], tx_links: ["https://testnet.nearblocks.io/txns/create_invoice-hash", "https://testnet.nearblocks.io/txns/record_verification-hash"] });
    expect(mocks.putVerification).toHaveBeenLastCalledWith(invoice.id, proof, "record_verification-hash");
    expect(mocks.putTx).toHaveBeenCalledWith("create_invoice-hash", exporter, invoice.id, "create_invoice", "create");
    expect(mocks.putTx).toHaveBeenCalledWith("record_verification-hash", "attester.testnet", invoice.id, "record_verification", "verify");
    expect(mocks.verify.mock.calls[0][0].pdfBytes.every((byte: number) => byte === 0)).toBe(true);
    for (const [, , detail] of mocks.audit.mock.calls) expect(JSON.parse(detail).actor).toBe("guided");
  });
  it("passes custom face and tenor to the chain and verifier", async () => {
    expect((await invoicePost(request({ face: "25000000", tenor_days: 30 }))).status).toBe(200);
    expect(mocks.call.mock.calls[0][1].args).toMatchObject({ face: "25000000", tenor_days: 30 });
    expect(mocks.verify.mock.calls[0][0].formFields).toMatchObject({ face: "25000000", tenor_days: 30 });
  });
  it("sample PDFs pass the actual existing mock verification flow", async () => {
    const { runVerification } = await vi.importActual<typeof import("../src/server/nearai/verify-flow")>("../src/server/nearai/verify-flow");
    for (const [face, tenor_days, invoice_number] of [["10000000", 60, "TW-0042"], ["25000001", 30, "G-0123abcd-2"]] as const) {
      const pdfBytes = await samplePdf(face, tenor_days, invoice_number);
      const result = await runVerification({ invoiceId: invoice.id, pdfBytes, formFields: { exporter, buyer, buyer_label: "Gulf Foods Trading (sample)", invoice_number, face, tenor_days, currency: "USDC" } });
      expect(result.verdict).toBe("pass"); expect(result.mock).toBe(true); expect(pdfBytes.every(byte => byte === 0)).toBe(true);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("accepts as buyer with on-chain terms and one yocto", async () => {
    expect((await acceptPost(request({ invoice_id: invoice.id }))).status).toBe(200);
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith(buyer, { contractId: "core.testnet", methodName: "accept_invoice", args: { id: invoice.id, terms_hash: invoice.terms_hash }, gas: 30_000_000_000_000n, attachedDeposit: 1n });
  });
  it("previews before requesting advance as exporter, with exact minimum", async () => {
    expect((await advancePost(request({ invoice_id: invoice.id }))).status).toBe(200);
    expect(mocks.view).toHaveBeenCalledWith(exporter, { contractId: "core.testnet", methodName: "preview_advance", args: { id: invoice.id } });
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith(exporter, { contractId: "core.testnet", methodName: "request_advance", args: { id: invoice.id, expected_terms_hash: invoice.terms_hash, min_advance: "7000000" }, gas: 100_000_000_000_000n, attachedDeposit: 0n });
  });
  it("rejects ineligible advances without signing", async () => {
    mocks.view.mockImplementation(async (_account, call) => call.methodName === "get_invoice" ? invoice : { eligible: false, reason: "Buyer exposure limit reached" });
    const response = await advancePost(request({ invoice_id: invoice.id }));
    expect(response.status).toBe(409); expect((await response.json()).error).toBe("Not eligible: Buyer exposure limit reached"); expect(mocks.call).not.toHaveBeenCalled();
  });
  it("returns sandbox hashes without explorer links", async () => {
    vi.stubEnv("NEAR_NETWORK", "sandbox");
    const response = await advancePost(request({ invoice_id: invoice.id }));
    expect(await response.json()).toMatchObject({ tx_hashes: ["request_advance-hash"], tx_links: [] });
  });
  it("increments invoice numbers in the same session", async () => {
    await invoicePost(request()); await invoicePost(request());
    expect(mocks.call.mock.calls.filter(([, call]) => call.methodName === "create_invoice").map(([, call]) => call.args.invoice_number)).toEqual(["G-aaaaaaaa-1", "G-aaaaaaaa-2"]);
  });
  it("rejects mutation without a session or with a different session buyer", async () => {
    const noCookie = request({ invoice_id: invoice.id }); noCookie.headers.delete("cookie");
    expect((await acceptPost(noCookie)).status).toBe(403);
    mocks.view.mockResolvedValue({ ...invoice, buyer: "another-session.testnet" });
    expect((await acceptPost(request({ invoice_id: invoice.id }))).status).toBe(403);
    expect(mocks.call).not.toHaveBeenCalled();
  });
  function payments(balance = "3000000", paid = "0") {
    mocks.view.mockImplementation(async (_account, call) => {
      if (call.methodName === "get_invoice") return { ...invoice, status: "Funded", paid: { total: paid, overpaid: "0" } };
      if (call.methodName === "get_config") return { min_payment: "1000000" };
      if (call.methodName === "ft_balance_of") return balance;
      throw new Error("Unexpected view");
    });
  }
  it("mints only a shortfall then repays with 300 TGas and one yocto", async () => {
    payments();
    const response = await payPost(request({ invoice_id: invoice.id })); expect(response.status).toBe(200);
    expect(mocks.call.mock.calls[0]).toEqual([buyer, { contractId: "usdc.testnet", methodName: "mint", args: { account_id: buyer, amount: "7000000" }, gas: 30_000_000_000_000n, attachedDeposit: 1_250_000_000_000_000_000_000n }]);
    const transfer = mocks.call.mock.calls[1][1];
    expect(transfer).toMatchObject({ contractId: "usdc.testnet", methodName: "ft_transfer_call", args: { receiver_id: "core.testnet", amount: "10000000" }, gas: 300_000_000_000_000n, attachedDeposit: 1n });
    expect(JSON.parse(transfer.args.msg)).toEqual({ action: "repay", invoice_id: invoice.id, payment_ref: expect.stringMatching(/^guided:[0-9a-f-]{36}$/) });
    expect((await response.json()).tx_hashes).toEqual(["mint-hash", "ft_transfer_call-hash"]);
    expect(mocks.putTx).toHaveBeenCalledWith("mint-hash", buyer, invoice.id, "mint", "other");
    expect(mocks.putTx).toHaveBeenCalledWith("ft_transfer_call-hash", buyer, invoice.id, "ft_transfer_call", "repay");
  });
  it("supports minimum-size partial payments without minting when funded", async () => {
    payments("1000000");
    expect((await payPost(request({ invoice_id: invoice.id, amount: "1000000" }))).status).toBe(200);
    expect(mocks.call).toHaveBeenCalledTimes(1); expect(mocks.call.mock.calls[0][1].args.amount).toBe("1000000");
  });
  it("refuses sub-minimum partial payments and overpayment", async () => {
    payments();
    for (const amount of ["999999", "10000001"]) expect((await payPost(request({ invoice_id: invoice.id, amount }))).status).toBe(400);
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("allows full outstanding dust below min_payment", async () => {
    payments("500000", "9500000");
    expect((await payPost(request({ invoice_id: invoice.id, amount: "500000" }))).status).toBe(200);
    expect(mocks.call.mock.calls[0][1].args.amount).toBe("500000");
  });
  it("preserves completed transactions on verification failure without leaking errors", async () => {
    mocks.verify.mockRejectedValue(new Error("private internal detail"));
    const response = await invoicePost(request()); expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ invoice_id: invoice.id, tx_hashes: ["create_invoice-hash"], error: "Verification service unavailable" });
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(mocks.verify.mock.calls[0][0].pdfBytes.every((byte: number) => byte === 0)).toBe(true);
  });
  it("does not attest an unverified live proof", async () => {
    mocks.verify.mockResolvedValue({ ...proof, mock: false, verified_ok: false });
    const response = await invoicePost(request()); expect(response.status).toBe(422);
    expect(mocks.call).toHaveBeenCalledTimes(1); expect(mocks.call.mock.calls[0][1].methodName).toBe("create_invoice");
  });
  it("does not mint for a nonpayable invoice or an already paid balance", async () => {
    expect((await payPost(request({ invoice_id: invoice.id }))).status).toBe(409);
    payments("0", "10000000");
    expect((await payPost(request({ invoice_id: invoice.id }))).status).toBe(400);
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("breaks faucet shortfalls into mint-cap-sized calls", async () => {
    mocks.view.mockImplementation(async (_account, call) => {
      if (call.methodName === "get_invoice") return { ...invoice, face: "1500000000", status: "Funded" };
      if (call.methodName === "get_config") return { min_payment: "1000000" };
      if (call.methodName === "ft_balance_of") return "0";
    });
    expect((await payPost(request({ invoice_id: invoice.id }))).status).toBe(200);
    expect(mocks.call.mock.calls.map(([, call]) => [call.methodName, call.args.amount])).toEqual([["mint", "1000000000"], ["mint", "500000000"], ["ft_transfer_call", "1500000000"]]);
  });
});

describe("account mutex", () => {
  it("serializes the same account, allows other accounts, and releases on failure", async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const order: string[] = [];
    const first = withAccountLock("mutex.testnet", async () => { order.push("first"); await blocked; throw new Error("failed"); });
    const rejected = expect(first).rejects.toThrow("failed");
    const second = withAccountLock("mutex.testnet", async () => { order.push("second"); });
    await withAccountLock("independent.testnet", async () => { order.push("independent"); });
    expect(order).toEqual(["first", "independent"]);
    release(); await rejected; await second;
    expect(order).toEqual(["first", "independent", "second"]);
    await withAccountLock("mutex.testnet", async () => { order.push("third"); });
    expect(order.at(-1)).toBe("third");
  });
});
