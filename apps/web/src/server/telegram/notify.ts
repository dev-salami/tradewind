import { Bot, InlineKeyboard } from "grammy";
import { drainOutbox, type AutomationStore } from "@tradewind/core/automation-store";
import type { TelegramCard } from "@tradewind/core";
import { telegramApiRoot } from "./config";
export function keyboard(card: TelegramCard) {
  const result = new InlineKeyboard();
  card.buttons.forEach((b, index) => {
    if (index > 0) result.row();
    if (b.url) result.url(b.text, b.url); else if (b.callback_data) result.text(b.text, b.callback_data);
  });
  return result;
}
export async function flushNotifications(s: AutomationStore) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const bot = token ? new Bot(token, { client: { apiRoot: telegramApiRoot(), timeoutSeconds: 15 } }) : null;
  await drainOutbox(s, token, (chat, card) => bot!.api.sendMessage(chat, card.text, { parse_mode: "HTML", reply_markup: keyboard(card) }));
}
