import type { InvoiceStatus } from "./types";
export type Tone = "green" | "amber" | "coral" | "slate";
const statuses: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  Created: { label: "Created", tone: "slate" }, Verified: { label: "Checked", tone: "slate" },
  Rejected: { label: "Rejected", tone: "coral" }, Accepted: { label: "Accepted", tone: "amber" },
  AdvancePending: { label: "Advance pending", tone: "amber" }, Funded: { label: "Awaiting payment", tone: "amber" },
  PartiallyPaid: { label: "Partially paid", tone: "amber" }, Repaid: { label: "Paid", tone: "green" },
  Defaulted: { label: "Defaulted", tone: "coral" }, Cancelled: { label: "Cancelled", tone: "slate" },
};
export function statusInfo(status: InvoiceStatus, overdue = false) {
  return overdue && status !== "Repaid" && status !== "Defaulted" ? { label: "Overdue", tone: "coral" as const } : statuses[status];
}
export function contractDay(nowNs: bigint | string, acceptedAtNs: bigint | string, secondsPerDay: number): bigint {
  if (secondsPerDay <= 0) throw new Error("Invalid contract clock");
  const delta = BigInt(nowNs) - BigInt(acceptedAtNs);
  return delta <= 0n ? 0n : delta / (BigInt(secondsPerDay) * 1_000_000_000n);
}
export function dueInText(nowNs: bigint | string, dueAtNs: string | null, secondsPerDay: number): string {
  if (!dueAtNs) return "Starts on acceptance";
  if (secondsPerDay <= 0) throw new Error("Invalid contract clock");
  const delta = BigInt(dueAtNs) - BigInt(nowNs);
  const day = BigInt(secondsPerDay) * 1_000_000_000n;
  if (delta === 0n) return "Due now";
  const days = (delta < 0n ? -delta : delta) / day + ((delta < 0n ? -delta : delta) % day > 0n ? 1n : 0n);
  return delta > 0n ? `Due in ${days} ${days === 1n ? "day" : "days"}` : `Overdue · ${days} ${days === 1n ? "day" : "days"}`;
}
