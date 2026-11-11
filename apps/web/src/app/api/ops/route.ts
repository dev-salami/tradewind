import { isOwner } from "@/server/auth/owner";
import { getSession } from "@/server/auth/session";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const allowed = await isOwner(request);
  return Response.json({ isOwner: allowed, accountId: allowed ? getSession(request)?.accountId : null }, { headers: { "Cache-Control": "private, no-store" } });
}
