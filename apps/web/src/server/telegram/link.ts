import { telegramStore } from "./store";
import { assertSameOrigin, getSession } from "../auth/session";
export function validAccount(account: unknown): account is string { return typeof account === "string" && /^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$/.test(account); }
export function sameOrigin(request: Request) { return request.headers.get("origin") === new URL(process.env.PUBLIC_BASE_URL || request.url).origin; }
export function devIdentity(request: Request, account: unknown): account is string { return process.env.NODE_ENV !== "production" && sameOrigin(request) && validAccount(account); }
export function linkIdentity(request: Request, account: unknown): { verified: boolean } | null {
  try { assertSameOrigin(request); } catch { return null; }
  if (!validAccount(account)) return null;
  const session = getSession(request);
  if (session) return session.accountId === account ? { verified: true } : null;
  return devIdentity(request, account) ? { verified: false } : null;
}
export async function linkPost(request: Request) {
  const body = await request.json();
  const identity = linkIdentity(request, body.account_id);
  if (!identity) return Response.json({ error: "Wallet authentication required (development links are unverified)." }, { status: 401 });
  const role = body.role ?? "exporter";
  if (!["exporter", "buyer", "lp"].includes(role)) return Response.json({ error: "Invalid role" }, { status: 400 });
  const username = process.env.TELEGRAM_BOT_USERNAME;
  if (!username || !/^[a-zA-Z0-9_]{5,32}$/.test(username)) return Response.json({ error: "Telegram username not configured; notifications remain available in the app." }, { status: 503 });
  const code = telegramStore().issueCode(body.account_id, role, identity.verified);
  return Response.json({ url: `https://t.me/${username}?start=${code}`, expires_in: 600, verified: identity.verified });
}
