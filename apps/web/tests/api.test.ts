// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { makeFixtures, sha256Hex } from "@tradewind/core";
import { recoverMessageAddress } from "viem";
import { repository } from "../src/server/db";
import { POST as draftPost } from "../src/app/api/invoices/draft/route";
import { POST as verifyPost } from "../src/app/api/invoices/[id]/verify/route";
import { GET as proofGet } from "../src/app/api/verify/[id]/route";
import { GET as healthGet } from "../src/app/api/health/route";
const mocks = vi.hoisted(() => ({ store: vi.fn(), invoice: vi.fn(), record: vi.fn() }));
vi.mock("../src/server/db", async importOriginal => ({ ...await importOriginal<typeof import("../src/server/db")>(), store: mocks.store }));
vi.mock("../src/server/near/view", () => ({ onChainInvoice: mocks.invoice }));
vi.mock("../src/server/near/attester", () => ({ recordVerification: mocks.record }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const params = { params: Promise.resolve({ id: "TW-0042" }) };
const req = (id: string) => new Request("http://localhost/api/invoices/TW-0042/verify", { method: "POST", body: JSON.stringify({ draft_id: id }) });
async function createDraft() {
  const pdf = await PDFDocument.create(); const page = pdf.addPage(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  ["Seller: Sample Cashew Exports Ltd (sample)", "Buyer: Gulf Foods Trading (sample)", "Invoice: TW-0042", "Issued: 2026-11-01", "Due: 2026-12-31", "Net 60", "W320 2 x 3.00 = 6.00", "W320 1 x 4.00 = 4.00", "Total: 10.00 USDC"].forEach((t, i) => page.drawText(t, { x: 25, y: 700 - i * 25, size: 12, font }));
  const bytes = await pdf.save();
  const body = new FormData(); body.set("file", new Blob([bytes as Uint8Array<ArrayBuffer>]), "sample.pdf");
  body.set("form_fields", JSON.stringify({ buyer_label: "Gulf Foods Trading (sample)", face: "10000000", tenor_days: 60 }));
  const response = await draftPost(new Request("http://localhost/api/invoices/draft", { method: "POST", body }));
  expect(response.status).toBe(200);
  return { ...await response.json(), hash: sha256Hex(bytes) };
}
describe("API integration with mock inference, in-memory SQLite and no network", () => {
  it("draft → on-chain fields → attester → public proof; deletes draft", async () => {
    vi.stubEnv("AI_MODE", "mock"); vi.stubEnv("NEAR_NETWORK", "testnet");
    const repo = repository(":memory:"); mocks.store.mockReturnValue(repo);
    try {
      const draft = await createDraft();
      expect(draft.doc_hash).toBe(draft.hash); expect(draft.verdict_preview).toBe("pass"); expect(draft.mock).toBe(true);
      expect(repo.getDraft(draft.draft_id)?.text).toContain("TW-0042");
      const invoice = makeFixtures("Created").invoices.find(i => i.id === "TW-0042")!;
      mocks.invoice.mockResolvedValue({ ...invoice, doc_hash: draft.doc_hash, face: "9000000" });
      mocks.record.mockResolvedValue("test-only-tx");
      const response = await verifyPost(req(draft.draft_id), params);
      expect(response.status).toBe(200);
      const result = await response.json(); expect(result.verdict).toBe("fail"); // Must use ON-CHAIN face, not prefill result.
      expect(result.tx_hash).toBe("test-only-tx"); expect(result.mock).toBe(true);
      expect(mocks.record).toHaveBeenCalledOnce();
      expect(repo.getDraft(draft.draft_id)).toBeUndefined();
      const stored = repo.getVerification("TW-0042")!;
      expect(stored.signature_kind).toBe("mock");
      mocks.invoice.mockResolvedValue({ ...invoice, verification: { ...stored, at: "0" } });
      const raw = await proofGet(new Request("http://localhost/api/verify/TW-0042"), params);
      expect(raw.status).toBe(200);
      const proof = await raw.json();
      expect(proof.source).toBe("chain"); expect(proof.mock).toBe(true);
      expect(proof.model_id).toBe("mock/sample-parser");
      expect(proof.request_hash).toMatch(/^[a-f0-9]{64}$/); expect(proof.response_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(proof.text).toBe(`${proof.model_id}:${proof.request_hash}:${proof.response_hash}`);
      expect(proof.signature).toMatch(/^0x[a-f0-9]{130}$/i);
      const recovered = await recoverMessageAddress({ message: proof.text, signature: proof.signature });
      expect(recovered.toLowerCase()).toBe("0x2c7536e3605d9c16a7a3d7b1898e529396a65c23");
      expect(recovered.toLowerCase()).toBe(proof.signing_address.toLowerCase());
      expect(proof).not.toHaveProperty("extracted");
      expect(proof).not.toHaveProperty("checks"); expect(proof).not.toHaveProperty("shipping_text");
      mocks.invoice.mockRejectedValueOnce(new Error("Fixture RPC unavailable"));
      const cached = await (await proofGet(new Request("http://localhost/api/verify/TW-0042"), params)).json();
      expect(cached).toMatchObject({ source: "db", signature_kind: "mock", signature: proof.signature, text: proof.text });
    } finally { repo.db.close(); }
  });
  it("blocks missing drafts, wrong status, mismatched document and mainnet mock", async () => {
    vi.stubEnv("AI_MODE", "mock"); vi.stubEnv("NEAR_NETWORK", "testnet");
    const repo = repository(":memory:"); mocks.store.mockReturnValue(repo);
    try {
      expect((await verifyPost(req("missing"), params)).status).toBe(404);
      const draft = await createDraft();
      const invoice = makeFixtures("Created").invoices.find(i => i.id === "TW-0042")!;
      mocks.invoice.mockResolvedValue({ ...invoice, status: "Funded" });
      expect((await verifyPost(req(draft.draft_id), params)).status).toBe(409);
      mocks.invoice.mockResolvedValue(invoice);
      expect((await verifyPost(req(draft.draft_id), params)).status).toBe(409);
      mocks.invoice.mockResolvedValue({ ...invoice, doc_hash: draft.doc_hash });
      vi.stubEnv("NEAR_NETWORK", "mainnet");
      expect((await verifyPost(req(draft.draft_id), params)).status).toBe(403);
      expect(mocks.record).not.toHaveBeenCalled();
    } finally { repo.db.close(); }
  });
  it("health is sanitized and missing public proof is JSON 404", async () => {
    vi.stubEnv("AI_MODE", "mock"); vi.stubEnv("NEAR_NETWORK", "testnet");
    const repo = repository(":memory:"); mocks.store.mockReturnValue(repo);
    try {
      const response = await healthGet(); expect(await response.json()).toMatchObject({ ok: true, network: "testnet", ai_mode: "mock", last_indexed_block: null });
      const missing = await proofGet(new Request("http://localhost"), params);
      expect(missing.status).toBe(404); expect(await missing.json()).toEqual({ error: "Verification not found" });
    } finally { repo.db.close(); }
  });
});
