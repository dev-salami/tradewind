import type { Config, Invoice, Paid } from "./types";
export const BPS = 10_000n;
const min = (a: bigint, b: bigint) => a < b ? a : b;
function unsigned(n: bigint): bigint { if (n < 0n) throw new Error("Negative amount"); return n; }
export function ceilDiv(n: bigint, d: bigint): bigint {
  unsigned(n); if (d <= 0n) throw new Error("Invalid divisor"); return (n + d - 1n) / d;
}
export function periods(tenorDays: number | bigint): bigint {
  return ceilDiv(BigInt(tenorDays), 30n);
}
export function advanceTerms(face: bigint, rateBps: number, tenorDays: number, config: Pick<Config, "pool_fee_bps_per_30d" | "protocol_fee_bps">) {
  unsigned(face);
  if (rateBps < 0 || rateBps > 10_000) throw new Error("Invalid rate");
  const advance = face * BigInt(rateBps) / BPS;
  const pool_fee = ceilDiv(face * BigInt(config.pool_fee_bps_per_30d) * periods(tenorDays), BPS);
  const protocol_fee = ceilDiv(face * BigInt(config.protocol_fee_bps), BPS);
  const pool_due = advance + pool_fee;
  const exporter_rest = face - pool_due - protocol_fee;
  return { advance, pool_fee, protocol_fee, pool_due, exporter_rest };
}
export function advanceRate(score: number, frozen: boolean, config: Pick<Config, "base_rate_bps" | "rate_step_bps" | "max_rate_bps">): number {
  if (frozen || score < 0) return 0;
  return Math.min(config.base_rate_bps + Math.min(score, 15) * config.rate_step_bps, config.max_rate_bps);
}
export function buyerLimit(repaidVolume: bigint, config: Pick<Config, "base_buyer_limit" | "limit_from_volume_bps">): bigint {
  return BigInt(config.base_buyer_limit) + unsigned(repaidVolume) * BigInt(config.limit_from_volume_bps) / BPS;
}
export function sharesForDeposit(amount: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return unsigned(amount) * (unsigned(totalShares) + 1n) / (unsigned(totalAssets) + 1n);
}
export function usdcForRedeem(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return unsigned(shares) * (unsigned(totalAssets) + 1n) / (unsigned(totalShares) + 1n);
}
export function sharePriceE6(totalAssets: bigint, totalShares: bigint): bigint {
  return (unsigned(totalAssets) + 1n) * 1_000_000n / (unsigned(totalShares) + 1n);
}
export const emptyPaid = (): Paid => ({ total: "0", to_pool_principal: "0", to_pool_fee: "0", to_protocol: "0", to_exporter: "0", overpaid: "0" });
export type WaterfallSplit = Omit<Paid, "total">;
/** Pure §6.7 allocation. The caller moves principal out of outstanding OR written_off. */
export function applyWaterfall(invoice: Pick<Invoice, "face" | "advance" | "paid">, payment: bigint) {
  let rem = unsigned(payment);
  const split: WaterfallSplit = { to_pool_principal: "0", to_pool_fee: "0", to_protocol: "0", to_exporter: "0", overpaid: "0" };
  const allocate = (key: keyof WaterfallSplit, owed: bigint) => {
    const remaining = owed - BigInt(invoice.paid[key]);
    const x = min(rem, remaining > 0n ? remaining : 0n);
    rem -= x; split[key] = x.toString();
  };
  const a = invoice.advance;
  if (a) {
    allocate("to_pool_principal", BigInt(a.amount));
    allocate("to_pool_fee", BigInt(a.pool_fee));
    allocate("to_protocol", BigInt(a.protocol_fee));
  }
  allocate("to_exporter", BigInt(invoice.face) - (a ? BigInt(a.amount) + BigInt(a.pool_fee) + BigInt(a.protocol_fee) : 0n));
  split.overpaid = rem.toString();
  const paid = { ...invoice.paid, total: (BigInt(invoice.paid.total) + payment).toString() };
  for (const key of Object.keys(split) as (keyof WaterfallSplit)[]) paid[key] = (BigInt(paid[key]) + BigInt(split[key])).toString();
  return { split, paid, status: BigInt(paid.total) - BigInt(paid.overpaid) >= BigInt(invoice.face) ? "Repaid" as const : "PartiallyPaid" as const };
}
/** Recover each payment's split without inventing fields absent from the view JSON. */
export function paymentSplits(invoice: Invoice) {
  let paid = emptyPaid();
  return invoice.payments.map(payment => {
    const result = applyWaterfall({ ...invoice, paid }, BigInt(payment.amount));
    paid = result.paid;
    return { payment, split: result.split };
  });
}
