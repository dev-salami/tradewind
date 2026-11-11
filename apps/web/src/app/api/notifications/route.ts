import { telegramStore } from "@/server/telegram/store";
import { validAccount } from "@/server/telegram/link";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const account = new URL(request.url).searchParams.get("account");
  if (!validAccount(account)) return Response.json({ error: "Invalid account" }, { status: 400 });
  const rows = telegramStore().db.prepare("SELECT id, kind, payload, status, created_at FROM notifications_outbox WHERE near_account=? ORDER BY id DESC LIMIT 100").all(account);
  // These cards contain public contract data only. Callback capabilities stay private to Telegram.
  return Response.json(rows.map(row => {
    const card = JSON.parse(String(row.payload));
    const buttons = card.buttons.flatMap((b: { text: string; url?: string; callback_data?: string }) => {
      if (b.url) return [{ text: b.text, url: b.url }];
      if (b.text !== "✅ Approve advance") return [];
      const token = telegramStore().callback(b.callback_data || "");
      return token ? [{ text: b.text, url: `/app/i/${encodeURIComponent(token.invoice_id)}?advance=1` }] : [];
    });
    return { ...row, payload: { text: card.text, buttons } };
  }));
}
