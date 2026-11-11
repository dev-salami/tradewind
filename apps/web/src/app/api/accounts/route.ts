import { z } from "zod";
import { store } from "@/server/db";
import { jsonError, ApiError } from "@/server/errors";
import { allowRequest } from "@/server/rate-limit";
import { requireSession } from "@/server/auth/session";
export const runtime = "nodejs";
const profile = z.object({ account_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$/), display_name: z.string().trim().min(1).max(80), country: z.string().trim().min(1).max(80) });
// Display metadata only: never use this table for authorization. Writes need a session for the same account.
export async function POST(request: Request) {
  try {
    const session = requireSession(request); // same-origin + NEP-413 session cookie
    if (!allowRequest(`account:${request.headers.get("x-forwarded-for") || "unknown"}`)) throw new ApiError("Rate limit exceeded", 429);
    const parsed = profile.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("Invalid profile");
    const body = parsed.data;
    if (body.account_id !== session.accountId) throw new ApiError("Session account mismatch", 403);
    store().putAccount(body.account_id, "exporter", body.display_name, body.country);
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
export async function GET(request: Request) {
  const account = new URL(request.url).searchParams.get("account_id");
  if (!account || !/^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$/.test(account)) return Response.json({ error: "Invalid account" }, { status: 400 });
  return Response.json({ registered: !!store().getAccount(account) });
}
