import { describe, expect, it } from "vitest";
import { formatNs } from "../src/time";
describe("formatNs", () => {
  it("formats nanoseconds with UTC and contract days", () => {
    expect(formatNs("1794441600000000000")).toBe("2026-11-12 00:00:00 UTC");
    expect(formatNs("1794442200000000000", { originNs: "1794441600000000000", secondsPerDay: 10 })).toBe("2026-11-12 00:10:00 UTC · contract day 60");
  });
  it("preserves milliseconds and floors negative days", () => {
    expect(formatNs("1234567890")).toBe("1970-01-01 00:00:01.234 UTC");
    expect(formatNs("0", { originNs: "1", secondsPerDay: 10 })).toContain("contract day -1");
  });
  it("rejects invalid timestamps and day durations", () => {
    expect(() => formatNs("invalid")).toThrow();
    expect(() => formatNs("0", { originNs: "0", secondsPerDay: 0 })).toThrow();
    expect(() => formatNs("99999999999999999999999999999999999")).toThrow();
  });
});
