import "server-only";
import { CHECK_IDS, type Check, type Extracted } from "./prompt";
export function recomputeVerdict(checks: Check[]): "pass" | "warn" | "fail" {
  if (CHECK_IDS.some(id => checks.filter(c => c.id === id).length !== 1)) return "fail";
  const failed = checks.filter(c => !c.ok);
  return !failed.length ? "pass" : failed.every(c => ["shipping_doc_consistent", "no_obvious_tampering_signals"].includes(c.id)) ? "warn" : "fail";
}
export function minorUnits(value: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) throw new Error("Invalid decimal amount");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}
export function recomputeLineItemSum(extracted: Extracted, face?: string): Check[] {
  let sum = false, total = false;
  try {
    const amount = minorUnits(extracted.total);
    sum = extracted.line_items.length > 0 && extracted.line_items.reduce((s, i) => s + minorUnits(i.amount), 0n) + minorUnits(extracted.tax || "0") === amount;
    total = face !== undefined && /^\d+$/.test(face) && amount === BigInt(face);
  } catch { /* Missing/invalid amounts must fail closed. */ }
  return [{ id: "sum_matches_total", ok: sum, note: sum ? "Exact line-item sum + tax matches total" : "Line-item sum + tax does not match total" },
    { id: "total_matches_form_face", ok: total, note: total ? "Total matches form face" : "Total does not match form face" }];
}
