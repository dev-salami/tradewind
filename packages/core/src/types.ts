/** Contract JSON: U128 money and U64 nanosecond timestamps never become JS numbers. */
export type Units = string;
export type Timestamp = string;
export type InvoiceStatus = "Created" | "Verified" | "Rejected" | "Accepted" | "AdvancePending" | "Funded" | "PartiallyPaid" | "Repaid" | "Defaulted" | "Cancelled";
export interface Verification {
  verdict: "pass" | "warn" | "fail";
  model_id: string; request_hash: string; response_hash: string;
  signature: string; signing_address: string; signing_algo: string; chat_id: string; at: Timestamp;
}
export interface Advance { rate_bps: number; amount: Units; pool_fee: Units; protocol_fee: Units; at: Timestamp }
export interface Paid {
  total: Units; to_pool_principal: Units; to_pool_fee: Units; to_protocol: Units; to_exporter: Units; overpaid: Units;
}
export interface Payment { amount: Units; at: Timestamp; sender: string; payment_ref: string }
export interface Invoice {
  id: string; exporter: string; buyer: string; buyer_label: string; invoice_number: string;
  face: Units; currency: "USDC"; tenor_days: number; doc_hash: string; terms_hash: string;
  created_at: Timestamp; accepted_at: Timestamp | null; due_at: Timestamp | null;
  verification: Verification | null; status: InvoiceStatus; overdue: boolean;
  advance: Advance | null; paid: Paid; payments: Payment[];
}
export interface BuyerRecord {
  accepted: number; repaid_on_time: number; repaid_grace: number; repaid_late: number;
  defaulted: number; recovered: number; repaid_volume: Units; open_principal: Units;
  score: number; frozen: boolean; last_update: Timestamp; rate_bps: number; buyer_limit: Units;
}
export interface Pool {
  idle: Units; outstanding_principal: Units; written_off: Units; total_assets: Units;
  total_shares: Units; share_price_e6: Units; fees_earned: Units; protocol_fees_paid: Units;
}
export interface AdvancePreview {
  rate_bps: number; advance: Units; pool_fee: Units; protocol_fee: Units;
  exporter_rest: Units; eligible: boolean; reason: string | null;
}
export interface Config {
  usdc: string; seconds_per_day: number; base_rate_bps: number; max_rate_bps: number;
  rate_step_bps: number; pool_fee_bps_per_30d: number; protocol_fee_bps: number;
  grace_days: number; default_after_days: number; min_counted_face: Units; min_payment: Units;
  max_face: Units; base_buyer_limit: Units; limit_from_volume_bps: number;
  max_single_advance_bps: number; invoice_counter_start: number; paused: boolean;
}
export interface StrayPayment { sender: string; amount: Units; msg: string; at: Timestamp }
export interface PoolHistoryPoint { at: Timestamp; share_price_e6: Units; label: string }
