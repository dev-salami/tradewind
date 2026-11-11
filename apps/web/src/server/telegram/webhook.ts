import { createHash, timingSafeEqual } from "node:crypto";
export function validWebhookSecret(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  return timingSafeEqual(createHash("sha256").update(provided).digest(), createHash("sha256").update(expected).digest());
}
