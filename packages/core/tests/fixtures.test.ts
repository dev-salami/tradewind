import { describe, expect, it } from "vitest";
import { makeFixtures, SAMPLE_BUYER, SAMPLE_EXPORTER, fixtureConfig } from "../src/fixtures";
import { advanceTerms, applyWaterfall, emptyPaid, sharePriceE6 } from "../src/math";
import { fixtureData } from "../src/datasource";
import { computeTermsHash } from "../src/terms";
import type { InvoiceStatus } from "../src/types";
describe("fixtures are one internally consistent sample ledger", () => {
  it.each(["Created", "Verified", "Rejected", "Accepted", "AdvancePending", "Funded", "PartiallyPaid", "Repaid", "Defaulted", "Cancelled"] as InvoiceStatus[])("replays stage %s", stage => {
    const f = makeFixtures(stage);
    let principal = 0n, losses = 0n, fees = 0n, protocol = 0n;
    for (const i of f.invoices) {
      expect(i.terms_hash).toBe(computeTermsHash(i));
      expect(i.buyer_label).toContain("(sample)");
      let paid = emptyPaid();
      for (const p of i.payments) {
        expect(BigInt(p.at)).toBeLessThanOrEqual(BigInt(f.now));
        paid = applyWaterfall({ ...i, paid }, BigInt(p.amount)).paid;
      }
      expect(paid).toEqual(i.paid);
      if (i.advance) {
        const terms = advanceTerms(BigInt(i.face), i.advance.rate_bps, i.tenor_days, fixtureConfig);
        expect(BigInt(i.advance.amount)).toBe(terms.advance);
        expect(BigInt(i.advance.pool_fee)).toBe(terms.pool_fee);
        expect(BigInt(i.advance.protocol_fee)).toBe(terms.protocol_fee);
        const open = terms.advance - BigInt(i.paid.to_pool_principal);
        if (i.status === "Defaulted") losses += open; else principal += open;
      }
      fees += BigInt(i.paid.to_pool_fee); protocol += BigInt(i.paid.to_protocol);
    }
    expect(BigInt(f.pool.total_assets)).toBe(20_000_000n + fees - losses);
    expect(BigInt(f.pool.outstanding_principal)).toBe(principal);
    expect(BigInt(f.pool.written_off)).toBe(losses);
    expect(BigInt(f.pool.idle) + principal).toBe(BigInt(f.pool.total_assets));
    expect(BigInt(f.pool.protocol_fees_paid)).toBe(protocol);
    expect(BigInt(f.pool.share_price_e6)).toBe(sharePriceE6(BigInt(f.pool.total_assets), BigInt(f.pool.total_shares)));
    expect(f.history.at(-1)?.share_price_e6).toBe(f.pool.share_price_e6);
    for (let n = 1; n < f.history.length; n++) expect(BigInt(f.history[n].at)).toBeGreaterThanOrEqual(BigInt(f.history[n - 1].at));
  });
  it("keeps Gulf Foods clean, Northgate frozen, and matches the video record", () => {
    const f = makeFixtures();
    expect(f.buyerRecord(SAMPLE_BUYER)).toMatchObject({ score: 10, repaid_on_time: 3, repaid_grace: 1, repaid_volume: "8000000", rate_bps: 8000, buyer_limit: "14000000", frozen: false });
    expect(f.buyerRecord("northgate-sample.testnet")).toMatchObject({ score: -15, frozen: true, rate_bps: 0 });
    expect(makeFixtures("Repaid").buyerRecord(SAMPLE_BUYER)?.score).toBe(13);
    expect(makeFixtures("Accepted").preview("TW-0042").eligible).toBe(true);
  });
  it("has async views with defensive copies and honest unknowns", async () => {
    const d = fixtureData();
    expect(await d.getInvoice("missing")).toBeNull();
    expect(await d.getBuyerRecord("missing")).toBeNull();
    expect(await d.listInvoices(1, 2)).toHaveLength(2);
    expect(await d.invoicesByExporter(SAMPLE_EXPORTER)).toHaveLength(7);
    const invoice = (await d.getInvoice("TW-0042"))!;
    invoice.face = "0";
    expect((await d.getInvoice("TW-0042"))?.face).toBe("10000000");
    expect(await d.getClaimable(SAMPLE_EXPORTER)).toBe("0");
    expect(await d.listUnattributed()).toEqual([]);
    expect(await d.isLpAllowed("sample-lp.testnet")).toBe(true);
  });
});
