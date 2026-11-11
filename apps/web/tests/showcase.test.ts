// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { fixtureData, type Invoice } from "@tradewind/core";
import { resolveShowcase, showcase } from "../src/server/showcase";
vi.mock("../src/lib/data", () => ({ data: vi.fn(), isFixtureMode: () => process.env.NEXT_PUBLIC_DATA_SOURCE === "fixtures" }));
afterEach(() => { vi.unstubAllEnvs(); });
it("prefers existing configured invoice/buyer over discovery", async () => {
  const f = fixtureData({ stage: "Repaid" }), invoice = (await f.getInvoice("TW-0042"))!;
  const listInvoices = vi.fn(async () => []);
  expect(await resolveShowcase({ ...f, listInvoices }, { invoiceId: invoice.id, buyer: invoice.buyer })).toEqual({ invoiceId: invoice.id, buyer: invoice.buyer });
  expect(listInvoices).not.toHaveBeenCalled();
});
it("falls back from missing or mismatched env to latest repaid across pages", async () => {
  const f = fixtureData({ stage: "Repaid" }), base = (await f.getInvoice("TW-0042"))!;
  const rows: Invoice[] = Array.from({ length: 52 }, (_, n) => ({ ...base, id: `TW-${String(1000 + n)}`, created_at: String(n + 1), status: n === 51 ? "Funded" : "Repaid" }));
  const listInvoices = vi.fn(async (from = 0, limit = 50) => rows.slice(from, from + limit));
  expect(await resolveShowcase({ ...f, listInvoices }, { invoiceId: "missing", buyer: undefined })).toEqual({ invoiceId: "TW-1050", buyer: base.buyer });
  expect(listInvoices).toHaveBeenCalledWith(50, 50);
  expect(await resolveShowcase({ ...f, listInvoices }, { invoiceId: base.id, buyer: "not-the-buyer.testnet" })).toEqual({ invoiceId: "TW-1050", buyer: base.buyer });
});
it("returns null on fresh deployments, no repaid invoice, and RPC failure", async () => {
  const f = fixtureData({ stage: "Funded" }), invoice = (await f.getInvoice("TW-0042"))!;
  const unset = { invoiceId: undefined, buyer: undefined };
  expect(await resolveShowcase({ ...f, listInvoices: async () => [] }, unset)).toBeNull();
  expect(await resolveShowcase({ ...f, listInvoices: async () => [invoice] }, unset)).toBeNull();
  expect(await resolveShowcase({ ...f, listInvoices: async () => { throw new Error("offline"); } }, unset)).toBeNull();
});
it("keeps fixture sample IDs without RPC access", async () => {
  vi.stubEnv("NEXT_PUBLIC_DATA_SOURCE", "fixtures");
  expect(await showcase()).toEqual({ invoiceId: "TW-0042", buyer: "gulf-foods-sample.testnet" });
});
