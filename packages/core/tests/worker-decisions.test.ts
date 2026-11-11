import { describe, expect, it } from "vitest";
import { fixtureConfig, invoiceTransitions, keeperActions, makeFixtures, reminderSteps, type Invoice, type ReminderStep } from "../src/index";
const i = makeFixtures().invoices.find(i => i.id === "TW-0042")!;
const day = BigInt(fixtureConfig.seconds_per_day) * 1_000_000_000n;
const at = (days: number) => (BigInt(i.due_at!) + BigInt(days) * day).toString();
describe("reminder scheduler", () => {
  it.each([[-7, "T-7"], [-1, "T-1"], [0, "D0"], [1, "T+1"], [7, "T+7"]] as const)("uses contract days at %i", (days, step) => {
    expect(reminderSteps(i, at(days), 10, new Set())).toEqual([step]);
    expect(reminderSteps(i, at(days), 10, new Set([step]))).toEqual([]);
    const production = { ...i, due_at: "10000000000000000" };
    const now = (BigInt(production.due_at) + BigInt(days) * 86400n * 1_000_000_000n).toString();
    expect(reminderSteps(production, now, 86400, new Set())).toEqual([step]);
  });
  it("does not replay missed windows or send T+ reminders after repayment", () => {
    expect(reminderSteps(i, at(3), 10, new Set())).toEqual([]);
    expect(reminderSteps({ ...i, paid: { ...i.paid, total: i.face } }, at(1), 10, new Set())).toEqual([]);
    expect(reminderSteps({ ...i, status: "Repaid" }, at(7), 10, new Set())).toEqual([]);
    const sent = new Set<ReminderStep>();
    for (const step of reminderSteps(i, at(-1), 10, sent)) sent.add(step);
    expect(reminderSteps(i, at(-1), 10, sent)).toEqual([]);
  });
});
describe("keeper", () => {
  it("uses strict deadlines, prioritises default, and skips terminal/pending states", () => {
    expect(keeperActions([i], i.due_at!, fixtureConfig)).toEqual([]);
    expect(keeperActions([i], (BigInt(i.due_at!) + 1n).toString(), fixtureConfig)).toEqual([{ id: i.id, method: "mark_overdue" }]);
    expect(keeperActions([{ ...i, overdue: true }], at(1), fixtureConfig)).toEqual([]);
    expect(keeperActions([i], at(31), fixtureConfig)).toEqual([{ id: i.id, method: "mark_default" }]);
    for (const status of ["Repaid", "Cancelled", "Defaulted", "AdvancePending"] as const) expect(keeperActions([{ ...i, status }], at(31), fixtureConfig)).toEqual([]);
  });
});
describe("transition → card mapping", () => {
  it.each([["Verified", "checked"], ["Rejected", "check_failed"], ["Accepted", "accepted"], ["Funded", "funded"], ["Defaulted", "defaulted"], ["Repaid", "repaid"]] as const)("maps %s", (status, event) => {
    expect(invoiceTransitions({ ...i, status: "Created" }, { ...i, status })).toContain(event);
  });
  it("diffs payments and overdue independently and is stable on replay", () => {
    const after: Invoice = { ...i, status: "PartiallyPaid", overdue: true, paid: { ...i.paid, total: "6000000" } };
    expect(invoiceTransitions(i, after)).toEqual(["payment_received", "overdue"]);
    expect(invoiceTransitions(after, after)).toEqual([]);
  });
});
