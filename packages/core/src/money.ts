export const USDC_SCALE = 1_000_000n;
export function toUnits(value: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) throw new Error("Enter a non-negative amount with at most 6 decimals");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * USDC_SCALE + BigInt(fraction.padEnd(6, "0"));
}
function fixed(units: bigint | string, decimals: number): string {
  const n = BigInt(units);
  const absolute = n < 0n ? -n : n;
  return `${n < 0n ? "-" : ""}${absolute / USDC_SCALE}.${(absolute % USDC_SCALE).toString().padStart(6, "0").slice(0, decimals)}`;
}
/** Display truncates, never changes the underlying base-unit amount. */
export function fromUnits(units: bigint | string): string { return fixed(units, 2); }
export function formatUsd(units: bigint | string, options: { decimals?: 2 | 6 } = {}): string {
  const [whole, fraction] = fixed(units, options.decimals ?? 2).split(".");
  const negative = whole.startsWith("-");
  const grouped = (negative ? whole.slice(1) : whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${fraction}`;
}
export function formatSharePrice(e6: bigint | string): string {
  const n = BigInt(e6);
  // Round the display to four places; the underlying e6 view remains exact.
  return fixed(n < 0n ? n - 50n : n + 50n, 4);
}
