import { linkPost, devIdentity, validAccount } from "@/server/telegram/link";
import { telegramStore } from "@/server/telegram/store";
export const runtime = "nodejs";
export const POST = linkPost;
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams, account = params.get("account");
  if (!validAccount(account)) return Response.json({ error: "Invalid account" }, { status: 400 });
  const link = telegramStore().link(account, params.get("role") || "exporter");
  return Response.json({ linked: !!link, verified: !!link?.verified, bot_account_id: process.env.BOT_ACCOUNT_ID || null });
}
export async function DELETE(request: Request) {
  const body = await request.json();
  if (!devIdentity(request, body.account_id)) return Response.json({ error: "Wallet authentication required" }, { status: 401 });
  const s = telegramStore();
  s.transaction(() => {
    const link = s.link(body.account_id, body.role || "exporter");
    s.db.prepare("DELETE FROM telegram_links WHERE near_account=? AND role=?").run(body.account_id, body.role || "exporter");
    s.db.prepare("DELETE FROM telegram_link_codes WHERE near_account=?").run(body.account_id);
    if (link) s.db.prepare("UPDATE telegram_callbacks SET used_at=? WHERE tg_user_id=? AND used_at IS NULL").run(Date.now(), link.tg_user_id);
    s.db.prepare("UPDATE notifications_outbox SET status='skipped_unlinked' WHERE near_account=? AND status='pending'").run(body.account_id);
  });
  return Response.json({ linked: false });
}
