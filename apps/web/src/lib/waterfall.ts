import type { WaterfallSplit } from "@tradewind/core";
export const WATERFALL_LANES = [
  { key: "to_pool_principal", label: "Pool principal", color: "#00C08B" },
  { key: "to_pool_fee", label: "Pool fee", color: "#14876C" },
  { key: "to_protocol", label: "Protocol", color: "#5B6B7F" },
  { key: "to_exporter", label: "Exporter", color: "#F5A524" },
  { key: "overpaid", label: "Overpaid · held for refund", color: "#E5484D" },
] as const;
/** Integer largest-remainder distribution: visual widths sum to exactly 100%. */
export function waterfallWidths(split: WaterfallSplit): number[] {
  const values = WATERFALL_LANES.map(lane => BigInt(split[lane.key]));
  const total = values.reduce((a, b) => a + b, 0n);
  if (!total) return values.map(() => 0);
  const widths = values.map(v => Number(v * 10_000n / total));
  let remainder = 10_000 - widths.reduce((a, b) => a + b, 0);
  const order = values.map((v, i) => ({ i, rem: v * 10_000n % total })).sort((a, b) => a.rem > b.rem ? -1 : a.rem < b.rem ? 1 : a.i - b.i);
  for (const { i } of order) { if (!remainder) break; widths[i]++; remainder--; }
  return widths.map(v => v / 100);
}
