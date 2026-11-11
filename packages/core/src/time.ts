/** Render nanoseconds without ever converting the ns value to a JS number. */
export function formatNs(ns: string, context?: { originNs: string; secondsPerDay: number }): string {
  const value = BigInt(ns);
  const millis = value / 1_000_000n;
  if (millis < -8_640_000_000_000_000n || millis > 8_640_000_000_000_000n) throw new RangeError("Timestamp out of range");
  const date = new Date(Number(millis)).toISOString().replace("T", " ").replace(".000Z", " UTC").replace("Z", " UTC");
  if (!context) return date;
  if (!Number.isSafeInteger(context.secondsPerDay) || context.secondsPerDay <= 0) throw new RangeError("Invalid contract day duration");
  const delta = value - BigInt(context.originNs), day = BigInt(context.secondsPerDay) * 1_000_000_000n;
  const n = delta >= 0n ? delta / day : -((-delta + day - 1n) / day);
  return `${date} · contract day ${n}`;
}
