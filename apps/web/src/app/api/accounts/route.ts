import { z } from "zod";
import { store } from "@/server/db";
import { jsonError, ApiError } from "@/server/errors";
import { allowRequest } from "@/server/rate-limit";
export const runtime = "nodejs";
const profile = z.object({ account_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$/), display_name: z.string().trim().min(1).max(80), country: z.string().trim().min(1).max(80) });
// Untrusted display metadata only: never use this table for authorization.
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new ApiError("Cross-origin request rejected", 403);
    if (!allowRequest(`account:${request.headers.get("x-forwarded-for") || "unknown"}`)) throw new ApiError("Rate limit exceeded", 429);
    const parsed = profile.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("Invalid profile");
    const body = parsed.data;
    store().putAccount(body.account_id, "exporter", body.display_name, body.country);
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
export async function GET(request: Request) {
  const account = new URL(request.url).searchParams.get("account_id");
  if (!account || !/^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$/.test(account)) return Response.json({ error: "Invalid account" }, { status: 400 });
  return Response.json({ registered: !!store().getAccount(account) });
}
