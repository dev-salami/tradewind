import { expect, it } from "vitest";
import { computeTermsHash, sha256Hex } from "../src/terms";
import { contractDay, dueInText, statusInfo } from "../src/status";
it("matches the independently generated sha256sum terms vector", () => {
  expect(computeTermsHash({ exporter: "sample-cashew.testnet", buyer: "gulf-foods-sample.testnet", invoice_number: "TW-0042", face: "10000000", tenor_days: 60, doc_hash: "abc123" })).toBe("64eac771fcd1864e0b3212b6fb943ce9a946aa833df4fbe8e24c331daab2ef45");
  expect(sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
it("uses contract nanoseconds, not wall-clock days", () => {
  expect(contractDay("19000000000", "0", 10)).toBe(1n);
  expect(contractDay("0", "100", 10)).toBe(0n);
  expect(dueInText("0", "410000000000", 10)).toBe("Due in 41 days");
  expect(dueInText("1", "0", 10)).toBe("Overdue · 1 day");
  expect(dueInText("0", null, 10)).toBe("Starts on acceptance");
  expect(dueInText("0", "0", 10)).toBe("Due now");
  expect(statusInfo("Funded", true)).toEqual({ label: "Overdue", tone: "coral" });
  expect(statusInfo("Repaid", true)).toEqual({ label: "Paid", tone: "green" });
});
