import { paymentSplits } from "./math";
import { USDC_SCALE } from "./money";
import type { Invoice } from "./types";

const invoiceHeader = ["id", "invoice_number", "exporter", "buyer", "buyer_label", "face_usdc", "currency", "tenor_days", "status", "created_at", "accepted_at", "due_at", "advance_rate_pct", "advance_usdc", "pool_fee_usdc", "protocol_fee_usdc", "paid_total_usdc"];
const paymentHeader = ["invoice_id", "part", "payer", "payment_ref", "at", "amount_usdc", "to_pool_principal", "to_pool_fee", "to_protocol", "to_exporter"];

function cell(value: string | number): string {
  const text = String(value).replace(/^[=+\-@\t\r]/, "'$&");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function row(values: (string | number)[]): string { return values.map(cell).join(",") + "\r\n"; }
function amount(units: string): string {
  const n = BigInt(units), absolute = n < 0n ? -n : n;
  return `${n < 0n ? "-" : ""}${absolute / USDC_SCALE}.${(absolute % USDC_SCALE).toString().padStart(6, "0")}`;
}
function timestamp(ns: string | null): string {
  if (ns === null) return "";
  const n = BigInt(ns), millis = n / 1_000_000n;
  if (n < 0n || millis > 8_640_000_000_000_000n) throw new RangeError("Timestamp out of range");
  const iso = new Date(Number(millis)).toISOString();
  // Keep sub-millisecond precision when present, without converting ns to Number.
  return n % 1_000_000n === 0n ? iso : iso.replace(/\.\d{3}Z$/, `.${(n % 1_000_000_000n).toString().padStart(9, "0")}Z`);
}

/** RFC 4180 CSV; missing dates/rates are blank, absent advances are zero USDC. */
export function invoicesCsv(invoices: readonly Invoice[]): string {
  return row(invoiceHeader) + invoices.map(i => {
    const rate = i.advance ? BigInt(i.advance.rate_bps) : null;
    return row([
      i.id, i.invoice_number, i.exporter, i.buyer, i.buyer_label, amount(i.face), i.currency,
      i.tenor_days, i.status, timestamp(i.created_at), timestamp(i.accepted_at), timestamp(i.due_at),
      rate === null ? "" : `${rate / 100n}.${(rate % 100n).toString().padStart(2, "0")}`,
      amount(i.advance?.amount ?? "0"), amount(i.advance?.pool_fee ?? "0"),
      amount(i.advance?.protocol_fee ?? "0"), amount(i.paid.total),
    ]);
  }).join("");
}

/** Payment parts are one-based within each invoice, in on-chain payment order. */
export function paymentsCsv(invoices: readonly Invoice[]): string {
  return row(paymentHeader) + invoices.map(i => paymentSplits(i).map(({ payment, split }, index) => row([
    i.id, index + 1, payment.sender, payment.payment_ref, timestamp(payment.at), amount(payment.amount),
    amount(split.to_pool_principal), amount(split.to_pool_fee), amount(split.to_protocol), amount(split.to_exporter),
  ])).join("")).join("");
}
