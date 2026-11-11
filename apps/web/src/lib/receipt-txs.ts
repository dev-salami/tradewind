export type TxKind = "create" | "verify" | "accept" | "advance" | "repay" | "claim" | "other";
export interface ReceiptTx { tx_hash: string; method: string | null; kind: TxKind | null; detail?: string }
export interface InvoiceTx extends ReceiptTx { account_id: string; invoice_id: string | null; created_at: number }
