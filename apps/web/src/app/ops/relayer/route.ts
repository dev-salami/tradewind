import { viewFunction } from "@tradewind/core";
import { requireSession } from "@/server/auth/session";
import { store } from "@/server/db";
import { env } from "@/server/env";
import { ApiError } from "@/server/errors";
import { payResponse } from "@/server/pay";

export async function GET(request: Request) {
  return payResponse(async () => {
    const session = requireSession(request), e = env();
    const roles = await viewFunction<{ owner: string }>(e.NEAR_RPC_URL, e.CORE_CONTRACT_ID, "get_roles", {});
    if (session.accountId !== roles.owner) throw new ApiError("Owner only", 403);
    const db = store().db;
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='relayer_forwards'").get();
    return { rows: exists ? db.prepare("SELECT r.* FROM relayer_forwards r JOIN payment_intents p ON p.pid=r.pid WHERE p.network=? ORDER BY r.updated_at DESC LIMIT 100").all(e.NEAR_NETWORK) : [] };
  });
}
