import "server-only";
export function tokenBucket(capacity = 10, windowMs = 60_000) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return (key: string, now = Date.now()) => {
    for (const [k, b] of buckets) if (now - b.at >= windowMs) buckets.delete(k);
    const b = buckets.get(key) ?? { tokens: capacity, at: now };
    b.tokens = Math.min(capacity, b.tokens + (now - b.at) * capacity / windowMs); b.at = now;
    buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens--; return true;
  };
}
export const allowRequest = tokenBucket();
