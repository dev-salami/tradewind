import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "../errors";
import { validAccountId } from "./nep413";

export interface Session { accountId: string; exp: number }
export const SESSION_SECONDS = 12 * 60 * 60;
function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || Buffer.byteLength(value) < 32) throw new ApiError("Session service not configured", 503);
  return value;
}
const mac = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");
export function createSessionToken(accountId: string, now = Date.now()): string {
  if (!validAccountId(accountId)) throw new ApiError("Invalid account");
  const payload = Buffer.from(JSON.stringify({ accountId, exp: Math.floor(now / 1000) + SESSION_SECONDS })).toString("base64url");
  return `${payload}.${mac(payload)}`;
}
export function getSession(request: Request, now = Date.now()): Session | null {
  const cookies = (request.headers.get("cookie") || "").split(";").map(part => part.trim()).filter(part => part.startsWith("tw_session="));
  if (cookies.length !== 1) return null;
  const token = cookies[0].slice("tw_session=".length);
  if (token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  try {
    const expected = Buffer.from(mac(parts[0])), actual = Buffer.from(parts[1]);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const session = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return validAccountId(session.accountId) && Number.isSafeInteger(session.exp) && session.exp > Math.floor(now / 1000) ? { accountId: session.accountId, exp: session.exp } : null;
  } catch { return null; }
}
export function assertSameOrigin(request: Request): void {
  const expected = new URL(process.env.PUBLIC_BASE_URL || request.url).origin;
  if (request.headers.get("origin") !== expected) throw new ApiError("Same-origin request required", 403);
}
// Owner/admin routes must additionally compare session.accountId with the resource owner.
export function requireSession(request: Request): Session {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) assertSameOrigin(request);
  const session = getSession(request);
  if (!session) throw new ApiError("Wallet authentication required", 401);
  return session;
}
export function sessionCookie(token: string, clear = false): string {
  return `tw_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_SECONDS}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
