import type { ExecutionStatus, QuoteResponse } from "./oneclick";
import type { Invoice } from "./types";

export const RELAYER_CONFIRM_TIMEOUT_MS = 600_000;
export interface ForwardRecord {
  state: "planned" | "sent" | "confirmed" | "held" | "failed" | "review";
  updated_at: number;
}
export interface RelayerIntent {
  pid: string;
  path: string;
  quoteResponse?: QuoteResponse;
  forward?: ForwardRecord;
  /** Explicit clock/config keeps planning pure (milliseconds, not chain nanoseconds). */
  now?: number;
  confirmTimeoutMs?: number;
}
export interface ForwardPlan {
  action: "wait" | "forward" | "hold" | "refund_review" | "done";
  amount?: bigint;
  reason: string;
}
/** Chain payment references are authoritative; a durable claim is never automatically retried. */
export function planForward(intent: RelayerIntent, status: ExecutionStatus, invoice: Invoice | null, alreadyForwarded: bigint): ForwardPlan {
  const result = (action: ForwardPlan["action"], reason: string): ForwardPlan => ({ action, reason });
  if (intent.path !== "B") return result("done", "Not Path B");
  if (invoice?.payments.some(p => p.payment_ref === intent.pid)) return result("done", "Payment confirmed on chain");
  if (status.status === "REFUNDED" || status.status === "FAILED") return result("done", status.status);
  if (status.status === "INCOMPLETE_DEPOSIT") return result("refund_review", "Incomplete deposit; review refund");
  const row = intent.forward;
  if (row && ["planned", "sent"].includes(row.state)) {
    return (intent.now ?? row.updated_at) - row.updated_at >= (intent.confirmTimeoutMs ?? RELAYER_CONFIRM_TIMEOUT_MS)
      ? result("refund_review", "Forward confirmation timeout; manual review required, never auto-resend")
      : result("wait", "Forward claimed or sent; awaiting chain reconciliation");
  }
  if (row && ["review", "failed", "confirmed"].includes(row.state)) return result("refund_review", "Existing forward requires manual reconciliation; never auto-resend");
  if (row?.state === "held") return result("hold", "Funds held; operator review required before any recovery");
  if (alreadyForwarded > 0n) return result("wait", "Already forwarded; awaiting chain reconciliation");
  if (status.status !== "SUCCESS") return result("wait", "Awaiting delivery");
  if (!invoice) return result("hold", "Invoice missing; hold delivered funds");
  if (!["Accepted", "Funded", "PartiallyPaid", "Defaulted"].includes(invoice.status)) return result("hold", "Invoice not payable; hold delivered funds");
  const outstanding = BigInt(invoice.face) - (BigInt(invoice.paid.total) - BigInt(invoice.paid.overpaid));
  if (outstanding <= 0n) return result("hold", "No outstanding balance; hold excess funds");
  const raw = status.quoteResponse?.quote?.amountOut ?? intent.quoteResponse?.quote?.amountOut;
  if (!raw || !/^\d+$/.test(raw) || BigInt(raw) <= 0n) return result("hold", "Missing or invalid delivered amount");
  const delivered = BigInt(raw), amount = delivered < outstanding ? delivered : outstanding;
  return { action: "forward", amount, reason: delivered > amount ? `Forward outstanding only; hold excess ${delivered - amount} base units for manual review` : "Delivery successful; forward to invoice" };
}
