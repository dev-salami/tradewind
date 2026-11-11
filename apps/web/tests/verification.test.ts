// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import * as dcap from "@phala/dcap-qvl";
import * as attestation from "../src/lib/attestation/verify-report";
vi.mock("@phala/dcap-qvl", async importOriginal => ({ ...await importOriginal<typeof import("@phala/dcap-qvl")>(), getCollateral: vi.fn() }));
import { fetchSignature, liveCompletion, hashBytes } from "../src/server/nearai/client";
import { CHECK_IDS, formSchema, resultSchema } from "../src/server/nearai/prompt";
import { minorUnits, recomputeLineItemSum, recomputeVerdict } from "../src/server/nearai/verdict";
import { mockCompletion, assertMockNetwork } from "../src/server/nearai/mock";
import { assertVerifiableModel, clearModelCache } from "../src/server/nearai/models";
import { verifyPublicSignature } from "../src/lib/verify-signature";
const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const form = formSchema.parse({ buyer_label: "Gulf Foods Trading (sample)", face: "10000000", tenor_days: 60 });
const text = "Seller: Sample Cashew Exports Ltd (sample) Buyer: Gulf Foods Trading (sample) Invoice: TW-0042 Issued: 2026-11-01 Due: 2026-12-31 Net 60 cashew kernels W320 2 x 3.00 = 6.00 cashew kernels W320 1 x 4.00 = 4.00 Total: 10.00 USDC";
const expected = { model_id: "z-ai/glm-5.3-flash", request_hash: "a".repeat(64), response_hash: "b".repeat(64), chat_id: "chat-test" };
const signedText = `${expected.model_id}:${expected.request_hash}:${expected.response_hash}`;
const reports = [{ signing_address: account.address, signing_algo: "ecdsa", request_nonce: "test" }];
async function signature(overrides = {}) { return { text: signedText, signing_algo: "ecdsa", signature_kind: "provider_tee", signing_address: account.address, signature: await account.signMessage({ message: signedText }), ...overrides }; }
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); clearModelCache(); });
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
    vi.stubEnv("NEARAI_MODEL_TEXT", expected.model_id); vi.stubEnv("NEARAI_E2EE", "0");
    const fixture = (name: string) => readFileSync(new URL(`./fixtures/nearai/${name}`, import.meta.url), "utf8");
    const report = JSON.parse(fixture("report-z-ai_glm-5.3-flash.json")).model_attestations[0];
    const collateral = JSON.parse(fixture("collateral-glm.json"));
    const nowSecs = Number(fixture("verify-now-secs.txt"));
    const verified = await attestation.verifyModelAttestation(report, { nonce: report.request_nonce, collateral, nowSecs });
    expect(verified.ok).toBe(true);
    vi.useFakeTimers(); vi.setSystemTime(nowSecs * 1000);
    const collateralStub = vi.mocked(dcap.getCollateral).mockResolvedValue(collateral);
    // The live quote's private signer key is unavailable. Stub the verified-report boundary
    // with the real fixture's result, substituting a local signer for response-signature coverage.
    const verifierStub = vi.spyOn(attestation, "verifyModelAttestation").mockResolvedValue({ ...verified, signingAddress: account.address });
    const raw = ` {"id":"chat-exact", "choices":[{"message":{"content":${JSON.stringify(JSON.stringify(mockCompletion(form, text).result))}}}]}\n`;
    let requestHash = "", nonce = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/models")) return Response.json({ data: [{ id: expected.model_id, owned_by: "nearai", is_ready: true }] });
      if (url.includes("attestation/report")) { nonce = new URL(url).searchParams.get("nonce")!; return Response.json({ model_attestations: [{ ...report, ...reports[0], request_nonce: nonce, signing_public_key: account.publicKey.slice(4) }] }); }
      if (url.endsWith("chat/completions")) {
        expect(typeof init?.body).toBe("string");
        expect(init?.headers).toMatchObject({ "x-no-aliasing": "true", "Accept-Encoding": "identity" });
        expect(JSON.parse(init!.body as string)).toMatchObject({ model: expected.model_id, temperature: 0, stream: false });
        const sent = JSON.parse(init!.body as string);
        expect(init!.body).toBe(JSON.stringify(sent));
        expect(sent.messages[0].role).toBe("system");
        expect(sent.messages.at(-1)).toEqual({ role: "user", content: expect.stringContaining(`FORM_FIELDS\n${JSON.stringify(form)}\nINVOICE_TEXT\n${text}`) });
        requestHash = hashBytes(init!.body as string); return new Response(raw);
      }
      if (!url.includes("/signature/")) throw new Error(`Unexpected fixture request: ${url}`);
      const payload = `${expected.model_id}:${requestHash}:${hashBytes(raw)}`;
      return Response.json({ ...await signature(), text: payload, signature: await account.signMessage({ message: payload }) });
    }));
    const result = await liveCompletion(form, text);
    expect(result.proof.verified_ok).toBe(true); expect(nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(result.proof.response_hash).toBe(hashBytes(raw)); expect(result.proof.request_hash).toBe(requestHash);
    expect(collateralStub).toHaveBeenCalledWith(expect.any(String), Uint8Array.from(Buffer.from(report.intel_quote, "hex")));
    expect(verifierStub).toHaveBeenCalledWith(expect.objectContaining({ intel_quote: report.intel_quote, request_nonce: nonce, signing_address: account.address }), { nonce, collateral, nowSecs });
    expect(result.proof.attestation_nonce).toBe(nonce);
    expect(result.proof.attestation_summary?.steps).toEqual(verified.steps);
  });
});
describe("model catalog", () => {
  it("requires an attested owner and readiness, caches ten minutes without metadata", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ data: [
      { id: expected.model_id, owned_by: "nearai", is_ready: true },
      { id: "Qwen/Qwen3-VL-30B-A3B-Instruct", owned_by: "attested 3p" },
      { id: "deepseek/deepseek-v3.2", owned_by: "nearai", is_ready: false },
      { id: "bad", owned_by: "untrusted", is_ready: true, metadata: { verifiable: true } },
      { id: "openai/fixture", owned_by: "openai", is_ready: true },
    ] })));
    vi.stubGlobal("fetch", fetch);
    await assertVerifiableModel(expected.model_id); await assertVerifiableModel(expected.model_id);
    await assertVerifiableModel("Qwen/Qwen3-VL-30B-A3B-Instruct");
    for (const id of ["bad", "deepseek/deepseek-v3.2", "openai/fixture"]) await expect(assertVerifiableModel(id)).rejects.toThrow("Model is not verifiable");
    await vi.advanceTimersByTimeAsync(599_999); await assertVerifiableModel(expected.model_id);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("fallback only permits canonical allowlist when catalog unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    for (const id of [expected.model_id, "Qwen/Qwen3-VL-30B-A3B-Instruct", "moonshotai/kimi-k3"]) await expect(assertVerifiableModel(id)).resolves.toBe(id);
    await expect(assertVerifiableModel("deepseek/deepseek-v3.2")).rejects.toThrow("Model is not verifiable");
    await expect(assertVerifiableModel("alias")).rejects.toThrow();
  });
  it("does not fallback over an explicit negative", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: [{ id: expected.model_id, owned_by: "nearai", is_ready: false }] })));
    await expect(assertVerifiableModel(expected.model_id)).rejects.toThrow();
  });
  it("refreshes the catalog after ten minutes", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: [{ id: expected.model_id, owned_by: "nearai", is_ready: true }] }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: expected.model_id, owned_by: "nearai", is_ready: false }] }));
    vi.stubGlobal("fetch", fetch);
    await assertVerifiableModel(expected.model_id);
    await vi.advanceTimersByTimeAsync(600_000);
    await expect(assertVerifiableModel(expected.model_id)).rejects.toThrow("Model is not verifiable");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
