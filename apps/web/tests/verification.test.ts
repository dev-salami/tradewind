// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { fetchSignature, liveCompletion, hashBytes } from "../src/server/nearai/client";
import { CHECK_IDS, formSchema, resultSchema } from "../src/server/nearai/prompt";
import { minorUnits, recomputeLineItemSum, recomputeVerdict } from "../src/server/nearai/verdict";
import { mockCompletion, assertMockNetwork } from "../src/server/nearai/mock";
import { assertVerifiableModel, clearModelCache } from "../src/server/nearai/models";
import { verifyPublicSignature } from "../src/lib/verify-signature";
const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const form = formSchema.parse({ buyer_label: "Gulf Foods Trading (sample)", face: "10000000", tenor_days: 60 });
const text = "Seller: Sample Cashew Exports Ltd (sample) Buyer: Gulf Foods Trading (sample) Invoice: TW-0042 Issued: 2026-11-01 Due: 2026-12-31 Net 60 cashew kernels W320 2 x 3.00 = 6.00 cashew kernels W320 1 x 4.00 = 4.00 Total: 10.00 USDC";
const expected = { model_id: "deepseek/deepseek-v3.2", request_hash: "a".repeat(64), response_hash: "b".repeat(64), chat_id: "chat-test" };
const signedText = `${expected.model_id}:${expected.request_hash}:${expected.response_hash}`;
const reports = [{ signing_address: account.address, signing_algo: "ecdsa", request_nonce: "test" }];
async function signature(overrides = {}) { return { text: signedText, signing_algo: "ecdsa", signature_kind: "provider_tee", signing_address: account.address, signature: await account.signMessage({ message: signedText }), ...overrides }; }
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); clearModelCache(); });
describe("verdict", () => {
  it("all branches and every check failure", () => {
    const checks = CHECK_IDS.map(id => ({ id, ok: true, note: "" }));
    expect(recomputeVerdict(checks)).toBe("pass");
    for (const id of CHECK_IDS) expect(recomputeVerdict(checks.map(c => ({ ...c, ok: c.id !== id })))).toBe(["shipping_doc_consistent", "no_obvious_tampering_signals"].includes(id) ? "warn" : "fail");
    expect(recomputeVerdict([])).toBe("fail");
    expect(recomputeVerdict([...checks, checks[0]])).toBe("fail");
    expect(recomputeVerdict(checks.map(c => ({ ...c, ok: !["shipping_doc_consistent", "no_obvious_tampering_signals"].includes(c.id) })))).toBe("warn");
    expect(recomputeVerdict(checks.map(c => ({ ...c, ok: false })))).toBe("fail");
  });
  it("uses decimal strings and integer arithmetic", () => {
    expect(minorUnits("9007199254740993.000001")).toBe(9007199254740993000001n);
    const extracted = mockCompletion(form, text).result.extracted;
    extracted.line_items[0].amount = "0.1"; extracted.line_items[1].amount = "0.2"; extracted.total = "0.3";
    expect(recomputeLineItemSum(extracted, "300000").every(c => c.ok)).toBe(true);
    extracted.tax = "0.01"; extracted.total = "0.31";
    expect(recomputeLineItemSum(extracted, "310000").every(c => c.ok)).toBe(true);
    expect(recomputeLineItemSum(extracted, "300000")[1].ok).toBe(false);
    extracted.line_items[0].amount = "1e2";
    expect(recomputeLineItemSum(extracted, "310000")[0].ok).toBe(false);
    expect(() => minorUnits("0.0000001")).toThrow();
    expect(resultSchema.safeParse({ ...mockCompletion(form, text).result, checks: [] }).success).toBe(false);
  });
  it("deterministic mock, rejected sample and mainnet guard", () => {
    const a = mockCompletion(form, text), b = mockCompletion(form, text);
    expect(a).toEqual(b); expect(a.proof.mock).toBe(true); expect(a.proof.verified_ok).toBe(false);
    expect(recomputeLineItemSum(a.result.extracted, form.face).every(c => c.ok)).toBe(true);
    expect(recomputeLineItemSum(mockCompletion(form, text.replace("4.00 = 4.00", "3.00 = 3.00")).result.extracted)[0].ok).toBe(false);
    expect(() => assertMockNetwork("mainnet")).toThrow("Mock verdicts cannot be recorded on mainnet");
    expect(() => assertMockNetwork("testnet")).not.toThrow();
  });
});
describe("response signatures", () => {
  it("accepts a valid provider_tee signature and public browser verification", async () => {
    const proof = await signature(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(proof)));
    expect((await fetchSignature(expected, reports)).verified_ok).toBe(true);
    await expect(verifyPublicSignature({ ...expected, ...proof })).resolves.toBeUndefined();
    await expect(verifyPublicSignature({ ...expected, ...proof, text: "wrong" })).rejects.toThrow("Signature text mismatch");
  });
  it.each([
    [{ text: "wrong" }, "Signature text mismatch"],
    [{ signing_address: "0x0000000000000000000000000000000000000001" }, "Recovered signer mismatch"],
    [{ signature_kind: "gateway" }, "Signature kind is not provider_tee"],
    [{ signing_algo: "ed25519" }, "Unsupported signing algorithm"],
  ])("rejects altered evidence %j", async (overrides, reason) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(await signature(overrides))));
    const result = await fetchSignature(expected, reports); expect(result.verified_ok).toBe(false); expect(result.verification_reason).toBe(reason);
  });
  it("rejects missing or ambiguous preflight signer", async () => {
    const body = await signature(); vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json(body))));
    expect((await fetchSignature(expected, [])).verified_ok).toBe(false);
    expect((await fetchSignature(expected, [...reports, ...reports])).verified_ok).toBe(false);
  });
  it("retries 404 then succeeds", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(Response.json(await signature()));
    vi.stubGlobal("fetch", fetch);
    expect((await fetchSignature(expected, reports, { sleep: async () => {} })).verified_ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("404 times out within budget", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 404 }))));
    const result = fetchSignature(expected, reports);
    await vi.advanceTimersByTimeAsync(20_001);
    expect((await result).verification_reason).toBe("Signature 404 timeout");
  });
  it("2xx error_code is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error_code: "unavailable" })));
    expect((await fetchSignature(expected, reports)).verified_ok).toBe(false);
  });
  it("live flow hashes exact bytes, canonical body and preflight nonce", async () => {
    vi.stubEnv("NEARAI_API_KEY", "test-only");
    const raw = ` {"id":"chat-exact", "choices":[{"message":{"content":${JSON.stringify(JSON.stringify(mockCompletion(form, text).result))}}}]}\n`;
    let requestHash = "", nonce = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/model/list")) return Response.json({ data: [{ id: expected.model_id, metadata: { verifiable: true } }] });
      if (url.includes("attestation/report")) { nonce = new URL(url).searchParams.get("nonce")!; return Response.json({ model_attestations: [{ ...reports[0], request_nonce: nonce }] }); }
      if (url.endsWith("chat/completions")) {
        expect(typeof init?.body).toBe("string");
        expect(init?.headers).toMatchObject({ "x-no-aliasing": "true", "Accept-Encoding": "identity" });
        expect(JSON.parse(init!.body as string)).toMatchObject({ model: expected.model_id, temperature: 0, stream: false });
        requestHash = hashBytes(init!.body as string); return new Response(raw);
      }
      const payload = `${expected.model_id}:${requestHash}:${hashBytes(raw)}`;
      return Response.json({ ...await signature(), text: payload, signature: await account.signMessage({ message: payload }) });
    }));
    const result = await liveCompletion(form, text);
    expect(result.proof.verified_ok).toBe(true); expect(nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(result.proof.response_hash).toBe(hashBytes(raw)); expect(result.proof.request_hash).toBe(requestHash);
  });
});
describe("model catalog", () => {
  it("requires explicit verifiable metadata, caches ten minutes", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ models: [{ modelId: expected.model_id, metadata: { verifiable: true } }, { modelId: "bad", metadata: { verifiable: false } }] })));
    vi.stubGlobal("fetch", fetch);
    await assertVerifiableModel(expected.model_id); await assertVerifiableModel(expected.model_id);
    await expect(assertVerifiableModel("bad")).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("fallback only permits canonical allowlist when catalog unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(assertVerifiableModel(expected.model_id)).resolves.toBe(expected.model_id);
    await expect(assertVerifiableModel("alias")).rejects.toThrow();
  });
  it("does not fallback over an explicit negative", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: [{ id: expected.model_id, metadata: { verifiable: false } }] })));
    await expect(assertVerifiableModel(expected.model_id)).rejects.toThrow();
  });
  it("refreshes the catalog after ten minutes", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ models: [{ modelId: expected.model_id, metadata: { verifiable: true } }] })));
    vi.stubGlobal("fetch", fetch);
    await assertVerifiableModel(expected.model_id);
    await vi.advanceTimersByTimeAsync(600_001);
    await assertVerifiableModel(expected.model_id);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
