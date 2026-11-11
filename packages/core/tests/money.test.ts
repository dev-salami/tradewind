import { describe, expect, it } from "vitest";
import { toUnits, fromUnits, formatUsd, formatSharePrice } from "../src/money";
describe("USDC integer formatting", () => {
  it("parses 6 decimal units without floats", () => {
    expect(toUnits("10.00")).toBe(10_000_000n);
    expect(toUnits("0.000001")).toBe(1n);
    expect(toUnits("0001.2")).toBe(1_200_000n);
    expect(toUnits("340282366920938463463374607431768.211455")).toBe((1n << 128n) - 1n);
  });
  it.each(["1.0000001", "1e6", "-1", ".5", "1.", " 10", "NaN", "", "1,000"])("rejects ambiguous input %s", value => expect(() => toUnits(value)).toThrow());
  it("formats bigints and JSON strings", () => {
    expect(fromUnits(10_000_000n)).toBe("10.00");
    expect(fromUnits("10000000")).toBe("10.00");
    expect(formatUsd("10000000")).toBe("$10.00");
    expect(formatUsd(12_345_678_901n)).toBe("$12,345.67");
    expect(formatUsd(1n, { decimals: 6 })).toBe("$0.000001");
    expect(formatUsd(-1_010_001n, { decimals: 6 })).toBe("-$1.010001");
    expect(formatSharePrice("1007500")).toBe("1.0075");
    expect(formatSharePrice("1007499")).toBe("1.0075");
    expect(fromUnits(999_999n)).toBe("0.99");
  });
});
