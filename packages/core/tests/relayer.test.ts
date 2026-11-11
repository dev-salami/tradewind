import { describe, expect, it } from "vitest";
import { makeFixtures, planForward, type ExecutionStatus, type Invoice, type RelayerIntent } from "../src/index";
const base = () => ({ ...makeFixtures().invoices[0], status: "Accepted", face: "100", paid: { ...makeFixtures().invoices[0].paid, total: "0", overpaid: "0" }, payments: [] }) as Invoice;
const status = (value = "SUCCESS", amount = "60") => ({ status: value, quoteResponse: { quote: { amountOut: amount } } }) as ExecutionStatus;
describe("Trusted settlement relayer planner", () => {
  it.each([
    ["PENDING_DEPOSIT", "wait"], ["KNOWN_DEPOSIT_TX", "wait"], ["PROCESSING", "wait"], ["SUCCESS", "forward"], ["FAILED", "done"], ["REFUNDED", "done"], ["INCOMPLETE_DEPOSIT", "refund_review"],
  ])("%s -> %s", (value, action) => expect(planForward({ pid: "pid", path: "B" }, status(value), base(), 0n).action).toBe(action));
  it.each(["Accepted", "Funded", "PartiallyPaid", "Defaulted"] as const)("forwards payable %s", state => expect(planForward({ pid: "pid", path: "B" }, status(), { ...base(), status: state }, 0n).amount).toBe(60n));
  it.each(["Created", "Verified", "Rejected", "AdvancePending", "Repaid", "Cancelled"] as const)("holds %s", state => expect(planForward({ pid: "pid", path: "B" }, status(), { ...base(), status: state }, 0n).action).toBe("hold"));
  it("caps to outstanding and explicitly holds excess", () => {
    const plan = planForward({ pid: "pid", path: "B" }, status("SUCCESS", "120"), base(), 0n);
    expect(plan).toMatchObject({ action: "forward", amount: 100n }); expect(plan.reason).toContain("hold excess 20");
  });
  it("reconciles payment before provider status and local row state", () => {
    const invoice = base(); invoice.payments = [{ payment_ref: "pid", amount: "60", at: "0", sender: "relayer.test.near" }];
    expect(planForward({ pid: "pid", path: "B", forward: { state: "sent", updated_at: 0 }, now: 700000 }, status("FAILED"), invoice, 60n).reason).toContain("confirmed on chain");
  });
  it.each(["planned", "sent"] as const)("never resends %s, including crash before send", state => {
    const intent: RelayerIntent = { pid: "pid", path: "B", forward: { state, updated_at: 1 }, now: 600000 };
    expect(planForward(intent, status(), base(), 0n).action).toBe("wait");
    expect(planForward({ ...intent, now: 600001 }, status(), base(), 0n).action).toBe("refund_review");
  });
  it.each(["review", "failed", "confirmed"] as const)("requires manual reconciliation for %s", state => expect(planForward({ pid: "pid", path: "B", forward: { state, updated_at: 0 } }, status(), base(), 0n).action).toBe("refund_review"));
  it("keeps held funds held and honors an explicit confirmation timeout", () => {
    expect(planForward({ pid: "pid", path: "B", forward: { state: "held", updated_at: 0 } }, status(), base(), 0n).action).toBe("hold");
    expect(planForward({ pid: "pid", path: "B", forward: { state: "sent", updated_at: 10 }, now: 20, confirmTimeoutMs: 10 }, status(), base(), 60n).action).toBe("refund_review");
  });
  it("handles missing invoice, missing amount, zero balance, alternate path and already forwarded", () => {
    const intent = { pid: "pid", path: "B" };
    expect(planForward(intent, status(), null, 0n).action).toBe("hold");
    expect(planForward(intent, status("SUCCESS", "bad"), base(), 0n).action).toBe("hold");
    const invoice = base(); invoice.paid.total = "100";
    expect(planForward(intent, status(), invoice, 0n).action).toBe("hold");
    expect(planForward({ ...intent, path: "A" }, status(), base(), 0n).action).toBe("done");
    expect(planForward(intent, status(), base(), 60n).action).toBe("wait");
    expect(planForward({ ...intent, quoteResponse: status().quoteResponse }, { ...status(), quoteResponse: undefined } as unknown as ExecutionStatus, base(), 0n).amount).toBe(60n);
  });
});
