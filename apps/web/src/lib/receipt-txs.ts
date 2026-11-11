export type TxKind = "create" | "verify" | "accept" | "advance" | "repay" | "claim" | "repaid" | "defaulted" | "cancelled" | "other";
export interface ReceiptTx { tx_hash: string; method: string | null; kind: TxKind | null; detail?: string }
export interface InvoiceTx extends ReceiptTx { account_id: string; invoice_id: string | null; created_at: number }
export const EVENT_RECEIPT_LABELS: Record<string, { kind: TxKind; label: string }> = {
  invoice_created: { kind: "create", label: "created" }, invoice_verified: { kind: "verify", label: "verified" },
  invoice_accepted: { kind: "accept", label: "accepted" }, advance_paid: { kind: "advance", label: "funded" },
  payment_received: { kind: "repay", label: "payment" }, invoice_repaid: { kind: "repaid", label: "repaid" },
  invoice_defaulted: { kind: "defaulted", label: "defaulted" }, invoice_cancelled: { kind: "cancelled", label: "cancelled" },
};
