import type { Config, Invoice } from "./types";
import type { ReminderStep } from "./telegram-cards";
const live = (i: Invoice) => ["Accepted", "Funded", "PartiallyPaid"].includes(i.status);
export function keeperActions(invoices: Invoice[], now: string, config: Pick<Config, "seconds_per_day" | "default_after_days">) {
  return invoices.flatMap<{ id: string; method: "mark_overdue" | "mark_default" }>(i => {
    if (!live(i) || !i.due_at) return [];
    const time = BigInt(now), due = BigInt(i.due_at);
    if (time > due + BigInt(config.default_after_days * config.seconds_per_day) * 1_000_000_000n) return [{ id: i.id, method: "mark_default" as const }];
    return time > due && !i.overdue ? [{ id: i.id, method: "mark_overdue" as const }] : [];
  });
}
export function reminderSteps(i: Invoice, now: string, secondsPerDay: number, sent: ReadonlySet<string>): ReminderStep[] {
  if (!i.due_at || !live(i) || BigInt(i.paid.total) - BigInt(i.paid.overpaid) >= BigInt(i.face)) return [];
  if (!Number.isSafeInteger(secondsPerDay) || secondsPerDay <= 0) throw new Error("Invalid contract day");
  const day = BigInt(secondsPerDay) * 1_000_000_000n, delta = BigInt(now) - BigInt(i.due_at);
  // Only the current contract-day window is due; a restart never floods stale reminders.
  return ([[-7, "T-7"], [-1, "T-1"], [0, "D0"], [1, "T+1"], [7, "T+7"]] as const).filter(([d, step]) => !sent.has(step) && delta >= BigInt(d) * day && delta < BigInt(d + 1) * day).map(([, step]) => step);
}
export type InvoiceEvent = "checked" | "check_failed" | "accepted" | "funded" | "payment_received" | "repaid" | "overdue" | "defaulted";
export function invoiceTransitions(before: Invoice | null, after: Invoice): InvoiceEvent[] {
  const events: InvoiceEvent[] = [];
  if (before?.status !== after.status) {
    const mapping = { Verified: "checked", Rejected: "check_failed", Accepted: "accepted", Funded: "funded", Repaid: "repaid", Defaulted: "defaulted" } as const;
    if (after.status in mapping) events.push(mapping[after.status as keyof typeof mapping]);
  }
  if (BigInt(after.paid.total) > BigInt(before?.paid.total ?? "0")) events.push("payment_received");
  if (after.overdue && !before?.overdue && after.status !== "Repaid" && after.status !== "Defaulted") events.push("overdue");
  return events;
}
export function retryPlan(attempts: number, now: number) { return { status: attempts >= 5 ? "failed" : "pending", next_attempt_at: now + Math.min(300_000, 1000 * 2 ** Math.max(0, attempts - 1)) }; }
