import { validWebhookSecret } from "@/server/telegram/webhook";
import { telegramWebhook } from "@/server/telegram/bot";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!validWebhookSecret(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), process.env.TELEGRAM_WEBHOOK_SECRET)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try { return await telegramWebhook(request); }
  catch { return Response.json({ error: "Telegram update unavailable" }, { status: 503 }); }
}
