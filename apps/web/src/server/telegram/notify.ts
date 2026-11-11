import { Bot, InlineKeyboard } from "grammy";
import { drainOutbox, type AutomationStore } from "@tradewind/core/automation-store";
import type { TelegramCard } from "@tradewind/core";
export function keyboard(card: TelegramCard) {
  const result = new InlineKeyboard();
  for (const b of card.buttons) { if (b.url) result.url(b.text, b.url); else if (b.callback_data) result.text(b.text, b.callback_data); result.row(); }
  return result;
}
export async function flushNotifications(s: AutomationStore) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const bot = token ? new Bot(token, { client: { timeoutSeconds: 15 } }) : null;
  await drainOutbox(s, token, (chat, card) => bot!.api.sendMessage(chat, card.text, { parse_mode: "HTML", reply_markup: keyboard(card) }));
}
