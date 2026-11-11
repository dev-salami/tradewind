// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { repository, migrate } from "../src/server/db";
import { tokenBucket } from "../src/server/rate-limit";
import { MAX_PDF_BYTES, validatePdf } from "../src/server/pdf";
import { POST } from "../src/app/api/invoices/draft/route";
import { runVerification } from "../src/server/nearai/verify-flow";
import { formSchema } from "../src/server/nearai/prompt";
import { recordVerification } from "../src/server/near/attester";
import { fixtureProof } from "../src/lib/fixture-proof";
import { verifyPublicSignature } from "../src/lib/verify-signature";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("rate limiter", () => {
  it("allows ten per IP, refills tokens and isolates IPs", () => {
    const allow = tokenBucket();
    for (let i = 0; i < 10; i++) expect(allow("a", 0)).toBe(true);
    expect(allow("a", 0)).toBe(false); expect(allow("b", 0)).toBe(true);
    expect(allow("a", 6000)).toBe(true); expect(allow("a", 6000)).toBe(false);
    expect(allow("a", 66000)).toBe(true);
  });
});
describe("database", () => {
  it("adds nullable tx metadata to a legacy table idempotently without losing rows", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("CREATE TABLE tx_log (tx_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, invoice_id TEXT, created_at INTEGER NOT NULL); INSERT INTO tx_log VALUES ('legacy-hash', 'sample.testnet', 'TW-0042', 1)");
      migrate(db); migrate(db);
      expect(db.prepare("PRAGMA table_info(tx_log)").all().map(row => row.name)).toEqual(["tx_hash", "account_id", "invoice_id", "created_at", "method", "kind"]);
      expect(db.prepare("SELECT * FROM tx_log").get()).toEqual({ tx_hash: "legacy-hash", account_id: "sample.testnet", invoice_id: "TW-0042", created_at: 1, method: null, kind: null });
    } finally { db.close(); }
  });
  it("enriches hashes, COALESCE preserves metadata, and invoice history is ordered", () => {
    const repo = repository(":memory:");
    try {
      repo.putTx("first-hash", "sample.testnet", null);
      repo.db.prepare("UPDATE tx_log SET created_at=1").run();
      repo.putTx("second-hash", "sample.testnet", "TW-0042", "accept_invoice", "accept");
      repo.putTx("first-hash", "sample.testnet", "TW-0042", "create_invoice", "create");
      repo.putTx("first-hash", "sample.testnet", null);
      repo.putTx("first-hash", "sample.testnet", null, null, null);
      expect(repo.txsForInvoice("TW-0042")).toEqual([
        { tx_hash: "first-hash", account_id: "sample.testnet", invoice_id: "TW-0042", created_at: 1, method: "create_invoice", kind: "create" },
        expect.objectContaining({ tx_hash: "second-hash", method: "accept_invoice", kind: "accept" }),
      ]);
      expect(repo.txsForInvoice("TW-9999")).toEqual([]);
      expect(() => repo.db.prepare("UPDATE tx_log SET kind='invented'").run()).toThrow();
    } finally { repo.db.close(); }
  });
  it.each(["method", "kind"])("completes a partially migrated tx table with only %s", column => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`CREATE TABLE tx_log (tx_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, invoice_id TEXT, created_at INTEGER NOT NULL, ${column} TEXT)`);
      migrate(db); migrate(db);
      const columns = db.prepare("PRAGMA table_info(tx_log)").all().map(row => row.name);
      expect(columns.filter(name => name === "method")).toHaveLength(1);
      expect(columns.filter(name => name === "kind")).toHaveLength(1);
    } finally { db.close(); }
  });
  it("idempotent file migrations and draft expiration", () => {
    const dir = mkdtempSync(join(tmpdir(), "tradewind-db-"));
    const repo = repository(join(dir, "test.db"));
    try {
      migrate(repo.db); migrate(repo.db);
      const draft = { draft_id: "test", exporter: "sample", doc_hash: "abc", text: "private extracted text", shipping_text: "", extracted_json: "{}", created_at: Date.now(), expires_at: Date.now() + 1000 };
      repo.putDraft(draft); expect(repo.getDraft("test")).toEqual(draft);
      repo.deleteDraft("test"); expect(repo.getDraft("test")).toBeUndefined();
      repo.putDraft({ ...draft, expires_at: 1 }); expect(repo.getDraft("test")).toBeUndefined();
      repo.putAccount("sample.testnet", "exporter", "Sample", "IN"); repo.putAccount("sample.testnet", "exporter", "Updated", "IN");
      expect(repo.db.prepare("SELECT display_name FROM accounts").get()?.display_name).toBe("Updated");
      repo.audit("test", "TW-0042", "{}");
    } finally { repo.db.close(); rmSync(dir, { recursive: true }); }
  });
});
async function postFile(bytes: Uint8Array) {
  const form = new FormData(); form.set("file", new Blob([bytes as Uint8Array<ArrayBuffer>]), "invoice.pdf");
  return POST(new Request("http://localhost/api/invoices/draft", { method: "POST", body: form, headers: { "x-forwarded-for": `test-${Math.random()}` } }));
}
describe("draft validation", () => {
  it("rejects size and magic before PDF parser", async () => {
    expect(() => validatePdf(new Uint8Array(MAX_PDF_BYTES + 1))).toThrow("5 MB");
    expect(() => validatePdf(new TextEncoder().encode("not pdf"))).toThrow("magic bytes");
    const magic = await postFile(new TextEncoder().encode("not pdf"));
    expect(magic.status).toBe(400); expect(await magic.json()).toEqual({ error: "Invalid PDF magic bytes" });
    expect((await postFile(new Uint8Array(MAX_PDF_BYTES + 1))).status).toBe(413);
  });
  it("rejects malformed multipart and fields as JSON errors", async () => {
    const bad = await POST(new Request("http://localhost", { method: "POST", body: "bad" }));
    expect(bad.status).toBe(400);
    const form = new FormData(); form.set("fields", "{bad");
    const result = await POST(new Request("http://localhost", { method: "POST", body: form }));
    expect(result.status).toBe(400); expect(await result.json()).toEqual({ error: "Invalid form fields JSON" });
  });
  it("rate limits route requests", async () => {
    for (let n = 0; n < 10; n++) await POST(new Request("http://localhost", { method: "POST", headers: { "x-forwarded-for": "limited" } }));
    const result = await POST(new Request("http://localhost", { method: "POST", headers: { "x-forwarded-for": "limited" } }));
    expect(result.status).toBe(429);
  });
});
describe("verification flow", () => {
  it("recomputes mock verdict and does not trust model verdict", async () => {
    vi.stubEnv("AI_MODE", "mock");
    const result = await runVerification({ invoiceId: "test", text: "Seller: Sample Buyer: Buyer Invoice: TW-0042 Issued: 2026-11-01 Due: 2026-12-31 Net 60 W320 2 x 3.00 = 6.00 W320 1 x 4.00 = 4.00 Total: 10.00 USDC", formFields: formSchema.parse({ buyer_label: "Buyer", face: "10000000", tenor_days: 60 }) });
    expect(result.verdict).toBe("pass"); expect(result.mock).toBe(true); expect(result.verified_ok).toBe(false);
    vi.stubEnv("NEAR_NETWORK", "mainnet");
    await expect(recordVerification("test", result)).rejects.toThrow("Mock verdicts cannot be recorded on mainnet");
    vi.stubEnv("NEAR_NETWORK", "testnet"); vi.stubEnv("ATTESTER_PRIVATE_KEY", "");
    await expect(recordVerification("test", result)).rejects.toThrow("attester key not configured");
  });
  it("scanned pages cap a valid mock sidecar at warn and always erase input PDF bytes", async () => {
    vi.stubEnv("AI_MODE", "mock"); vi.stubEnv("NEAR_NETWORK", "testnet");
    const pdf = await PDFDocument.create(), page = pdf.addPage();
    page.drawText("Seller: Sample Buyer: Buyer Invoice: TW-0042 Issued: 2026-11-01 Due: 2026-12-31 Net 60 W320 2 x 3.00 = 6.00 W320 1 x 4.00 = 4.00 Total: 10.00 USDC", { x: 10, y: 700, size: 4 });
    pdf.addPage(); // A page without extractable text selects vision even when another page has text.
    const bytes = await pdf.save();
    const result = await runVerification({ invoiceId: "test", pdfBytes: bytes, formFields: formSchema.parse({ buyer_label: "Buyer", face: "10000000", tenor_days: 60 }) });
    expect(result.scanned).toBe(true); expect(result.mock).toBe(true);
    expect(result.verdict).toBe("warn");
    expect(result.reasons).toContain("MOCK vision — scanned PDF not read");
    expect(result.checks.filter(c => !c.ok)).toEqual([{ id: "no_obvious_tampering_signals", ok: false, note: "MOCK vision — scanned PDF not read" }]);
    expect(bytes.every(b => b === 0)).toBe(true);
  });
  it("legacy Node PDF extraction works for text PDFs", async () => {
    vi.stubEnv("AI_MODE", "mock");
    const pdf = await PDFDocument.create(); const page = pdf.addPage(); const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("Invoice: TW-0042 W320 1 x 10.00 = 10.00 Total: 10.00 USDC", { x: 10, y: 700, size: 12, font });
    const bytes = await pdf.save();
    const result = await runVerification({ invoiceId: "test", pdfBytes: bytes, formFields: formSchema.parse({ face: "10000000" }) });
    expect(result.extracted.total).toBe("10.00"); expect(bytes.every(b => b === 0)).toBe(true);
  });
  it("fixture vector verifies with no network", async () => { await expect(verifyPublicSignature(fixtureProof)).resolves.toBeUndefined(); });
});
