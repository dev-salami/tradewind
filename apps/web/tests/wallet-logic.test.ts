import { describe, expect, it } from "vitest";
import { makeFixtures } from "@tradewind/core";
import { invoiceCreatedId, isOwner, newestMatchingInvoice, redirectHashes, txFailed } from "../src/lib/wallet-logic";
describe("redirect wallets", () => {
  const a = "A".repeat(44), b = "B".repeat(44);
  it("parses, validates and deduplicates transactionHashes, including encoded commas", () => {
    expect(redirectHashes(`https://example.test/app/new?transactionHashes=${a}%2C${b},${a}&other=1`)).toEqual([a, b]);
    expect(redirectHashes("https://example.test/?transactionHashes=,invalid,<script>," )).toEqual([]);
    expect(redirectHashes("https://example.test/")).toEqual([]);
  });
  it("extracts an invoice_created id from receipt EVENT_JSON, not unrelated logs", () => {
    const logs = ["noise", "EVENT_JSON:broken", 'EVENT_JSON:{"standard":"nep171","event":"invoice_created","data":[{"invoice_id":"TW-0001"}]}', 'EVENT_JSON:{"standard":"tradewind","event":"invoice_created","data":[{"invoice_id":"TW-0042"}]}'];
    expect(invoiceCreatedId({ receipts_outcome: [{ outcome: { logs } }] })).toBe("TW-0042");
    expect(invoiceCreatedId({ transaction_outcome: { outcome: { logs: [logs[3]] } } })).toBe("TW-0042");
    expect(invoiceCreatedId({})).toBeUndefined();
  });
  it("recognizes transaction and receipt failures", () => {
    expect(txFailed({ status: { Failure: { error: "failed" } } })).toBe(true);
    expect(txFailed({ receipts_outcome: [{ outcome: { status: { Failure: "panic" } } }] })).toBe(true);
    expect(txFailed({ status: { SuccessValue: "" } })).toBe(false);
  });
  it("recovers the newest matching document without reusing an old invoice", () => {
    const invoice = makeFixtures().invoices[0];
    const rows = [{ ...invoice, id: "TW-0001", created_at: "9", doc_hash: "match" }, { ...invoice, id: "TW-0002", created_at: "10", doc_hash: "match" }, { ...invoice, id: "TW-0003", created_at: "11", doc_hash: "other" }];
    expect(newestMatchingInvoice(rows, "match")?.id).toBe("TW-0002");
    expect(newestMatchingInvoice(rows, "match", ["TW-0002"])?.id).toBe("TW-0001");
    expect(newestMatchingInvoice(rows, "missing")).toBeUndefined();
  });
});
describe("ops owner gate", () => {
  it("fails closed for disconnected, unloaded and non-owner accounts", () => {
    expect(isOwner(null, "owner.testnet")).toBe(false);
    expect(isOwner("owner.testnet", undefined)).toBe(false);
    expect(isOwner("other.testnet", "owner.testnet")).toBe(false);
    expect(isOwner("owner.testnet", "owner.testnet")).toBe(true);
  });
});
