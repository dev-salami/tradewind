import { Bot, webhookCallback } from "grammy";
import { escapeHtml, formatUsd, formatSharePrice, type Invoice, type Pool } from "@tradewind/core";
import { telegramApiRoot } from "./config";
import { telegramStore } from "./store";
import { approvalDependencies } from "./dependencies";
import { handleCallback } from "./callbacks";
import { keyboard } from "./notify";
import { view } from "./near";
let instance: Bot | undefined;
export function getBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  if (instance) return instance;
  const bot = new Bot(token, { client: { apiRoot: telegramApiRoot(), timeoutSeconds: 15 } });
  bot.command("start", async ctx => {
    if (ctx.chat.type !== "private" || !ctx.from) { await ctx.reply("Link Telegram in a private chat."); return; }
    const code = ctx.match.trim();
    const ok = /^[a-f0-9]{32}$/.test(code) && telegramStore().consumeCode(code, String(ctx.from.id), String(ctx.chat.id));
    await ctx.reply(ok ? "Telegram linked for invoice notifications and reminders. Advance approvals still need wallet opt-in in app settings; unverified development links are notifications-only. Buyer payments always require your wallet." : "Link expired or invalid. Request a new link in settings.");
  });
  bot.command("stop", async ctx => {
    if (!ctx.from) return;
    const s = telegramStore(), user = String(ctx.from.id);
    s.transaction(() => {
      s.db.prepare("UPDATE notifications_outbox SET status='skipped_unlinked' WHERE status='pending' AND (chat_id=? OR near_account IN (SELECT near_account FROM telegram_links WHERE tg_user_id=?))").run(String(ctx.chat.id), user);
      s.db.prepare("DELETE FROM telegram_links WHERE tg_user_id=?").run(user);
      s.db.prepare("UPDATE telegram_callbacks SET used_at=? WHERE tg_user_id=? AND used_at IS NULL").run(Date.now(), user);
    });
    await ctx.reply("Unlinked. Revoke on-chain Telegram approvals in app settings if enabled.");
  });
  bot.command("invoices", async ctx => {
    if (!ctx.from) return;
    const links = telegramStore().db.prepare("SELECT near_account FROM telegram_links WHERE tg_user_id=?").all(String(ctx.from.id));
    if (!links.length) { await ctx.reply("Link your account in app settings first."); return; }
    const accounts = new Set(links.map(l => l.near_account));
    const invoices: Invoice[] = [];
    for (let from = 0; ; from += 100) { const batch = await view<Invoice[]>("list_invoices", { from_index: String(from), limit: 100 }); invoices.push(...batch); if (batch.length < 100) break; }
    await ctx.reply(invoices.filter(i => accounts.has(i.exporter) || accounts.has(i.buyer)).map(i => `${escapeHtml(i.id)} · ${escapeHtml(i.status)}`).join("\n") || "No invoices yet.", { parse_mode: "HTML" });
  });
  bot.command("pool", async ctx => { const p = await view<Pool>("get_pool"); await ctx.reply(`Pool assets: ${formatUsd(p.total_assets).replace("$", "")} USDC · Share price: ${formatSharePrice(p.share_price_e6)}`); });
  bot.command("help", ctx => ctx.reply("/start <code> — link from app settings\n/invoices — your invoices\n/pool — pool totals\n/stop — unlink\n/help — commands\nBuyer payments always require your wallet."));
  bot.on("callback_query:data", async ctx => {
    try {
      const card = await handleCallback(telegramStore(), approvalDependencies(), ctx.callbackQuery.data, String(ctx.from.id));
      await ctx.editMessageText(card.text, { parse_mode: "HTML", reply_markup: keyboard(card) });
      await ctx.answerCallbackQuery();
    } catch { await ctx.answerCallbackQuery({ text: "Button unavailable. Check the invoice in the app before retrying.", show_alert: true }); }
  });
  instance = bot; return bot;
}
export function telegramWebhook(request: Request) { const bot = getBot(); return bot ? webhookCallback(bot, "std/http")(request) : Response.json({ ok: true, status: "skipped_no_token" }); }
