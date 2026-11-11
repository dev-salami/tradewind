import { afterEach, expect, it, vi } from "vitest";
import { fixtureData, type InvoiceStatus } from "@tradewind/core";
import { openAutomationStore } from "@tradewind/core/automation-store";
import { guidedCleanup, guidedCleanupDecision, type JobDependencies } from "../src/jobs";
import { migrateGuided } from "../../web/src/server/guided/session-store";
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it.each(["Created", "Verified", "Accepted"] as InvoiceStatus[])("cancels stale %s without an advance, never recent invoices", async status => {
  const invoice = (await fixtureData({ stage: "Accepted" }).getInvoice("TW-0042"))!;
  expect(guidedCleanupDecision({ ...invoice, status, advance: null }, 0, 600_000)).toBe("cancel");
  expect(guidedCleanupDecision({ ...invoice, status, advance: null }, 1, 600_000)).toBeNull();
});
it.each(["Funded", "PartiallyPaid", "Defaulted"] as InvoiceStatus[])("repays stale %s with outstanding advance", async status => {
  const invoice = (await fixtureData({ stage: "Funded" }).getInvoice("TW-0042"))!;
  expect(guidedCleanupDecision({ ...invoice, status }, 0, 600_000)).toBe("repay");
  expect(guidedCleanupDecision({ ...invoice, status, paid: { ...invoice.paid, total: invoice.face, overpaid: "0" } }, 0, 600_000)).toBeNull();
});
it.each(["Repaid", "Cancelled", "Rejected", "AdvancePending"] as InvoiceStatus[])("skips terminal or in-flight %s", async status => {
  const invoice = (await fixtureData({ stage: "Funded" }).getInvoice("TW-0042"))!;
  expect(guidedCleanupDecision({ ...invoice, status }, 0, 600_000)).toBeNull();
});
it("uses configured age and protects guided invoices when cancellation is unavailable", async () => {
  const s = openAutomationStore(":memory:");
  try {
    const f = fixtureData({ stage: "Accepted" }), invoice = { ...(await f.getInvoice("TW-0042"))!, advance: null };
    vi.stubEnv("GUIDED_ENABLED", "1"); vi.stubEnv("GUIDED_EXPORTER_ACCOUNT_ID", invoice.exporter);
    vi.stubEnv("GUIDED_STALE_MINUTES", "1");
    migrateGuided(s.db);
    s.db.prepare("INSERT INTO guided_sessions (session_id,buyer_account,encrypted_key,created_at,ready) VALUES (?,?,?,?,1)").run("session", invoice.buyer, "encrypted-test-only", 0);
    const d: JobDependencies = { invoice: f.getInvoice, preview: f.previewAdvance, buyer: f.getBuyerRecord, approver: async () => null, send: vi.fn(), botAccount: "", base: "https://example.test", network: "sandbox", list: from => f.listInvoices(from, 50), pool: f.getPool, config: f.getConfig, keeper: vi.fn(), keeperConfigured: true };
    const send = vi.fn(async () => { throw new Error("MethodNotFound: cancel_invoice"); });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const now = Number(BigInt(invoice.created_at) / 1_000_000n) + 60_000;
    expect(await guidedCleanup(s, d, [invoice, { ...invoice, id: "unrelated", buyer: "another.testnet" }], now, send)).toEqual(new Set([invoice.id]));
    expect(send).toHaveBeenCalledTimes(1); expect(log).toHaveBeenCalledWith(expect.stringContaining("cancel_unavailable"));
    send.mockClear();
    vi.stubEnv("GUIDED_ENABLED", "0");
    expect(await guidedCleanup(s, d, [invoice], now, send)).toEqual(new Set([invoice.id]));
    expect(send).not.toHaveBeenCalled();
    expect(await guidedCleanup(s, { ...d, network: "mainnet" }, [invoice], now, send)).toEqual(new Set());
    expect(send).not.toHaveBeenCalled();
  } finally { s.db.close(); }
});
