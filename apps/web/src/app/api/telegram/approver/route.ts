import { devIdentity } from "@/server/telegram/link";
import { contract } from "@/server/telegram/near";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const body = await request.json();
  if (!devIdentity(request, body.account_id)) return Response.json({ error: "Wallet authentication required" }, { status: 401 });
  const bot = process.env.BOT_ACCOUNT_ID;
  if (!bot && body.enabled !== false) return Response.json({ error: "Bot account not configured" }, { status: 503 });
  // This endpoint builds arguments only. The wallet must sign the one-yocto opt-in/revocation.
  return Response.json({ receiverId: contract(), methodName: "set_approver", args: { approver: body.enabled === false ? null : bot }, gas: "30000000000000", deposit: "1" });
}
