// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { privateKeyToAccount } from "viem/accounts";
import type { Invoice } from "@tradewind/core";
import { repository } from "../src/server/db";
import { POST as draftPost } from "../src/app/api/invoices/draft/route";
import { POST as verifyPost } from "../src/app/api/invoices/[id]/verify/route";
import { GET as proofGet } from "../src/app/api/verify/[id]/route";
import { hashBytes, liveCompletion } from "../src/server/nearai/client";
import { verifyModelAttestation } from "../src/lib/attestation/verify-report";
import { clearModelCache } from "../src/server/nearai/models";
import { mockCompletion, PUBLIC_TEST_SIGNER_KEY } from "../src/server/nearai/mock";
import { formSchema } from "../src/server/nearai/prompt";
import { verifyPublicSignature } from "../src/lib/verify-signature";
import { decryptContent, encryptContent } from "../src/server/nearai/e2ee";

const state = vi.hoisted(() => ({ invoice: undefined as Invoice | undefined, repo: undefined as ReturnType<typeof repository> | undefined, chainFails: false }));
vi.mock("../src/server/db", async importOriginal => ({ ...await importOriginal<typeof import("../src/server/db")>(), store: () => state.repo! }));
vi.mock("../src/server/near/view", () => ({ onChainInvoice: async () => { if (state.chainFails) throw new Error("RPC unavailable"); return state.invoice; } }));
vi.mock("../src/server/near/attester", () => ({ recordVerification: async (_id: string, proof: Invoice["verification"]) => { state.invoice!.verification = proof; return "fixture-tx"; } }));
// Route tests isolate DCAP at its boundary. Real cryptographic verification and tampering are covered in attestation.test.ts.
vi.mock("@phala/dcap-qvl", () => ({ getCollateral: async () => ({}) }));
vi.mock("../src/lib/attestation/verify-report", () => ({ verifyModelAttestation: vi.fn(async (att: { signing_address: string }) => ({ ok: true, signingAddress: att.signing_address, steps: [{ id: "quote_dcap", ok: true, detail: "route test boundary stub" }], tcbStatus: "UpToDate", mrTdPrefix: "fixture" })) }));
const account = privateKeyToAccount(PUBLIC_TEST_SIGNER_KEY);
const form = formSchema.parse({ exporter: "exporter.testnet", buyer: "buyer.testnet", buyer_label: "Sample buyer", invoice_number: "TW-0042", face: "10000000", tenor_days: 60 });
const text = "Seller: Sample Export Buyer: Sample buyer Invoice: TW-0042 Issued: 2026-11-01 Due: 2026-12-31 Net 60 W320 2 x 5.00 = 10.00 Total: 10.00 USDC";
let completions: { model: string; messages: { content: unknown }[] }[];
let sentBodies: string[];
beforeEach(() => {
  state.repo = repository(":memory:"); state.chainFails = false; clearModelCache(); completions = []; sentBodies = [];
  vi.stubEnv("NEARAI_API_KEY", "fixture-only-not-a-key"); vi.stubEnv("AI_MODE", "live"); vi.stubEnv("NEARAI_E2EE", "0"); vi.stubEnv("NEAR_NETWORK", "sandbox");
  let requestHash = "", responseHash = "", model = "";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/models")) return Response.json(JSON.parse(readFileSync(new URL("./fixtures/nearai/models.json", import.meta.url), "utf8")));
    if (url.includes("/attestation/report?")) return Response.json({ model_attestations: [{ signing_address: account.address, signing_algo: "ecdsa", request_nonce: new URL(url).searchParams.get("nonce"), signing_public_key: account.publicKey.slice(4), intel_quote: "00" }] });
    if (url.endsWith("/chat/completions")) {
      const sent = JSON.parse(init!.body as string); completions.push(sent); model = sent.model;
      sentBodies.push(init!.body as string);
      requestHash = hashBytes(init!.body as string);
      const headers = new Headers(init?.headers);
      let content = JSON.stringify(mockCompletion(form, text).result);
      if (headers.get("X-Encryption-Version") === "2") {
        expect(decryptContent(sent.messages[0].content, Buffer.from(PUBLIC_TEST_SIGNER_KEY.slice(2), "hex"))).toContain("invoice checker");
        content = encryptContent(content, headers.get("X-Client-Pub-Key")!);
      }
      const raw = JSON.stringify({ id: "fixture-chat", choices: [{ message: { content } }] });
      responseHash = hashBytes(raw); return new Response(raw);
    }
    if (url.includes("/signature/")) {
      const payload = `${model}:${requestHash}:${responseHash}`;
      return Response.json({ text: payload, signature: await account.signMessage({ message: payload }), signing_address: account.address, signing_algo: "ecdsa", signature_kind: "provider_tee" });
    }
    throw new Error(`Unexpected fixture request: ${url}`);
  }));
});
afterEach(() => state.repo?.db.close());
async function draft(scanned = false) {
  const pdf = await PDFDocument.create(), page = pdf.addPage([500, 500]);
  if (scanned) {
    const canvas = createCanvas(100, 100), context = canvas.getContext("2d");
    context.fillStyle = "white"; context.fillRect(0, 0, 100, 100);
    const image = await pdf.embedPng(canvas.toBuffer("image/png"));
    page.drawImage(image, { x: 0, y: 0, width: 100, height: 100 });
  } else page.drawText(text, { x: 10, y: 100, size: 4 });
  const multipart = new FormData(); multipart.set("file", new Blob([Buffer.from(await pdf.save())], { type: "application/pdf" }), "invoice.pdf"); multipart.set("form_fields", JSON.stringify(form));
  const response = await draftPost(new Request("http://localhost/api/invoices/draft", { method: "POST", body: multipart, headers: { "x-forwarded-for": `fixture-${Math.random()}` } }));
  expect(response.status).toBe(200);
  const data = await response.json();
  state.invoice = { ...form, id: "17", doc_hash: data.doc_hash, status: "Created", verification: null } as Invoice;
  return data;
}
it.each([false, true])("draft result is reused only when form unchanged (changed=%s)", async changed => {
  const data = await draft();
  if (changed) state.invoice!.face = "11000000";
  const response = await verifyPost(new Request("http://localhost/api/invoices/17/verify", { method: "POST", body: JSON.stringify({ draft_id: data.draft_id }) }), { params: Promise.resolve({ id: "17" }) });
  expect(response.status).toBe(200);
  expect(completions).toHaveLength(changed ? 2 : 1);
  const proof = await (await proofGet(new Request("http://localhost/api/verify/17"), { params: Promise.resolve({ id: "17" }) })).json();
  expect(proof.source).toBe("chain");
  await verifyPublicSignature(proof);
  await expect(verifyPublicSignature({ ...proof, signing_address: "0x0000000000000000000000000000000000000001" })).rejects.toThrow("Recovered signer mismatch");
  state.chainFails = true;
  const fallback = await (await proofGet(new Request("http://localhost/api/verify/17"), { params: Promise.resolve({ id: "17" }) })).json();
  expect(fallback.source).toBe("db");
});
it("chain is authoritative even when the local cache differs; a missing chain proof is not a fallback", async () => {
  const data = await draft();
  state.invoice!.verification = { ...mockCompletion(form, text).proof, at: "0", verdict: "warn" };
  const response = await proofGet(new Request("http://localhost"), { params: Promise.resolve({ id: "17" }) });
  const proof = await response.json();
  expect(proof.source).toBe("chain"); expect(proof.mock).toBe(true);
  await verifyPublicSignature(proof);
  expect(proof.attestation_summary).toBeUndefined();
  expect(state.repo!.getDraft(data.draft_id)).toBeDefined();
  state.invoice!.verification = null;
  expect((await proofGet(new Request("http://localhost"), { params: Promise.resolve({ id: "17" }) })).status).toBe(404);
});
it("scanned PDF renders PNG content and selects the vision model", async () => {
  await draft(true);
  expect(completions).toHaveLength(1);
  expect(completions[0].model).toBe("Qwen/Qwen3-VL-30B-A3B-Instruct");
  expect(completions[0].messages.at(-1)?.content).toEqual([{ type: "text", text: expect.any(String) }, { type: "image_url", image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) } }]);
});
it("live encrypted completion hashes the exact ciphertext body, decrypts, then verifies the signed hashes", async () => {
  vi.stubEnv("NEARAI_E2EE", "1");
  const data = await draft();
  const cached = JSON.parse(state.repo!.getDraft(data.draft_id)!.extracted_json).verification;
  expect(cached.verified_ok).toBe(true);
  expect(cached.request_hash).toBe(hashBytes(sentBodies[0]));
  expect(sentBodies[0]).not.toContain("FORM_FIELDS");
  expect(cached.extracted.total).toBe("10.00");
});
it("no verified model report aborts before invoice data is sent and identifies the failing step", async () => {
  vi.mocked(verifyModelAttestation).mockResolvedValueOnce({ ok: false, signingAddress: account.address, steps: [{ id: "rtmr3_replay", ok: false, detail: "boundary rejection" }], tcbStatus: "UpToDate", mrTdPrefix: "fixture" });
  await expect(liveCompletion(form, text)).rejects.toThrow("Attestation verification failed: rtmr3_replay");
  expect(completions).toHaveLength(0);
});
