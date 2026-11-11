import { describe, expect, it } from "vitest";
import { advanceTerms, advanceRate, applyWaterfall, buyerLimit, emptyPaid, periods, sharePriceE6, sharesForDeposit, usdcForRedeem } from "../src/math";
import { fixtureConfig as config } from "../src/fixtures";
import { toUnits as u } from "../src/money";
import type { Advance, Invoice } from "../src/types";
describe("§6.4 fees and advance math", () => {
  it.each([
    ["12000", 8000, "9600", "180", "60", "2160"],
    ["10", 8000, "8", ".15", ".05", "1.80"],
    ["10", 7000, "7", ".15", ".05", "2.80"],
    ["10", 8500, "8.5", ".15", ".05", "1.30"],
  ] as const)("face %s at %i bps", (face, rate, advance, fee, protocol, rest) => {
    const n = (s: string) => u(s.startsWith(".") ? `0${s}` : s);
    expect(advanceTerms(u(face), rate, 60, config)).toEqual({ advance: u(advance), pool_fee: n(fee), protocol_fee: n(protocol), pool_due: u(advance) + n(fee), exporter_rest: u(rest) });
  });
  it("uses started periods; floors payouts and ceils obligations", () => {
    expect([1, 30, 31, 60, 61].map(periods)).toEqual([1n, 1n, 2n, 2n, 3n]);
    const terms = advanceTerms(101n, 7000, 31, config);
    expect(terms.advance).toBe(70n); expect(terms.pool_fee).toBe(2n); expect(terms.protocol_fee).toBe(1n);
    expect(advanceTerms(u("10"), 8500, 10000, config).exporter_rest).toBeLessThan(0n);
  });
});
describe("§6.5 record and caps", () => {
  it.each([[0, 7000], [10, 8000], [13, 8300], [15, 8500], [999, 8500], [-1, 0]])("score %i → %i", (score, expected) => expect(advanceRate(score, false, config)).toBe(expected));
  it("freezes any score and computes exposure from volume", () => {
    expect(advanceRate(15, true, config)).toBe(0);
    expect(buyerLimit(u("8"), config)).toBe(u("14"));
    expect(buyerLimit(1n, config)).toBe(u("10"));
  });
});
describe("§6.6 virtual shares", () => {
  it("20 seed → 8 advance → repayment with .15 fee", () => {
    const shares = sharesForDeposit(u("20"), 0n, 0n);
    expect(shares).toBe(u("20"));
    const idle = u("20") - u("8"), principal = u("8");
    expect(sharePriceE6(idle + principal, shares)).toBe(1_000_000n);
    const assets = idle + principal + u("0.15");
    expect(sharePriceE6(assets, shares)).toBe(1_007_499n);
    expect(1_007_500n - sharePriceE6(assets, shares)).toBeLessThanOrEqual(1n);
    expect(usdcForRedeem(shares, assets, shares)).toBe(u("20.15") - 1n);
    expect(sharePriceE6(0n, 0n)).toBe(1_000_000n);
  });
  it("floors deposits and redemptions, including a donation", () => {
    expect(sharesForDeposit(3n, 10n, 5n)).toBe(1n);
    expect(usdcForRedeem(1n, 10n, 5n)).toBe(1n);
    expect(sharesForDeposit(1n, u("100"), 1n)).toBe(0n);
  });
});
const advance: Advance = { rate_bps: 8000, amount: "8000000", pool_fee: "150000", protocol_fee: "50000", at: "0" };
const base = (): Pick<Invoice, "face" | "advance" | "paid"> => ({ face: "10000000", advance, paid: emptyPaid() });
describe("§6.7 waterfall", () => {
  it("allocates both partial payments exactly", () => {
    const first = applyWaterfall(base(), u("6"));
    expect(first.split).toEqual({ to_pool_principal: "6000000", to_pool_fee: "0", to_protocol: "0", to_exporter: "0", overpaid: "0" });
    expect(first.status).toBe("PartiallyPaid");
    const second = applyWaterfall({ ...base(), paid: first.paid }, u("4"));
    expect(second.split).toEqual({ to_pool_principal: "2000000", to_pool_fee: "150000", to_protocol: "50000", to_exporter: "1800000", overpaid: "0" });
    expect(second.status).toBe("Repaid");
    expect(second.paid.total).toBe("10000000");
  });
  it("holds overpayment, and never charges unadvanced invoices", () => {
    const result = applyWaterfall(base(), u("11"));
    expect(result.paid.overpaid).toBe("1000000");
    expect(Object.values(result.split).reduce((sum, v) => sum + BigInt(v), 0n)).toBe(u("11"));
    const direct = applyWaterfall({ ...base(), advance: null }, u("10"));
    expect(direct.paid.to_exporter).toBe("10000000"); expect(direct.paid.to_protocol).toBe("0");
    expect(() => applyWaterfall(base(), -1n)).toThrow();
  });
  it("conserves single units across many parts", () => {
    let i = base();
    for (const part of [1n, 8_000_000n, 149_999n, 50_000n, 1_800_001n]) {
      const result = applyWaterfall(i, part);
      expect(Object.values(result.split).reduce((sum, v) => sum + BigInt(v), 0n)).toBe(part);
      i = { ...i, paid: result.paid };
    }
    expect(i.paid.overpaid).toBe("1");
  });
});
