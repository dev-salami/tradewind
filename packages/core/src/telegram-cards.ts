import type { AdvancePreview, BuyerRecord, Invoice, Paid } from "./types";
import { formatUsd, formatSharePrice } from "./money";
export interface CardButton { text: string; callback_data?: string; url?: string }
export interface TelegramCard { text: string; buttons: CardButton[] }
export const escapeHtml = (v: unknown): string => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const e = escapeHtml;
const usd = (n: string) => e(formatUsd(n, { decimals: BigInt(n) % 10_000n === 0n ? 2 : 6 }));
const header = (kind: string, id: string) => `<b>Tradewind</b> · ${e(kind)} · <code>${e(id)}</code>`;
const url = (base: string, path: string) => `${base.replace(/\/$/, "")}${path}`;
const open = (i: Invoice, base: string, receipt = false): CardButton => ({ text: receipt ? "🧾 Receipt" : "🔎 Open invoice", url: url(base, `/${receipt ? "r" : "app/i"}/${encodeURIComponent(i.id)}`) });
const short = (s: string) => s.length > 12 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
export function advanceReady(i: Invoice, p: AdvancePreview, b: BuyerRecord | null, base: string, tokens?: { approve: string; skip: string }, changed = false): TelegramCard {
  const repaid = b ? b.repaid_on_time + b.repaid_grace + b.repaid_late + b.recovered : 0;
  return { text: `${header("advance ready", i.id)}${changed ? "\n\n<b>Terms changed, review again</b>" : ""}\n\n<b>🧾 Invoice</b>\n${usd(i.face)} USDC · ${e(i.buyer_label)} · Net ${e(i.tenor_days)}\n\n<b>📈 Advance rate</b>\n${e(p.rate_bps / 100)}% · buyer record: ${e(repaid)} repaid (${e(b?.repaid_on_time ?? 0)} on time) · score ${e(b?.score ?? 0)}\n\n<b>💰 You receive now</b>\n${usd(p.advance)} USDC\n\n<b>🧮 If the buyer pays on time</b>\nPool fee ${usd(p.pool_fee)} · protocol fee ${usd(p.protocol_fee)} · you get ${usd(p.exporter_rest)} more\n\n<blockquote><b>Will do:</b>\nSend exactly ${usd(p.advance)} USDC from the Tradewind pool to ${e(i.exporter)}. Terms ${e(short(i.terms_hash))}.</blockquote>${p.eligible ? "" : `\n\nAdvance not available yet: ${e(p.reason ?? "not eligible")}`}`,
    buttons: [...(p.eligible ? [{ text: "✅ Approve advance", ...(tokens ? { callback_data: tokens.approve } : { url: url(base, `/app/i/${encodeURIComponent(i.id)}?advance=1`) }) }] : []), ...(tokens ? [{ text: "✋ Not now", callback_data: tokens.skip }] : []), open(i, base)] };
}
export function approveState(i: Invoice, state: "sent" | "skipped", base: string, tx = "", txUrl = ""): TelegramCard {
  return { text: state === "sent" ? `${header("💸 Sent", i.id)} · tx <code>${e(tx)}</code>` : "Skipped. Advance stays available in the app.", buttons: state === "sent" && txUrl ? [{ text: "🔎 Transaction", url: txUrl }, open(i, base)] : [open(i, base)] };
}
function simple(i: Invoice, kind: string, body: string, base: string, receipt = false): TelegramCard { return { text: `${header(kind, i.id)}\n\n${body}`, buttons: [open(i, base, receipt)] }; }
export const checked = (i: Invoice, base: string) => simple(i, i.verification?.signing_algo === "mock" ? "✅ Invoice checked (MOCK — not a TEE result)" : "✅ Checked by NEAR AI (TEE)", `verdict pass · signature ${e(short(i.verification?.signature ?? ""))}`, base);
export const checkFailed = (i: Invoice, reasons: string[], base: string) => simple(i, "⚠️ Check failed", reasons.map(r => `• ${e(r)}`).join("\n"), base);
export const buyerAccepted = (i: Invoice, base: string) => simple(i, "🤝 Buyer accepted", `${e(i.buyer_label)} signed ${e(i.id)} · token minted`, base);
export const advanceSent = (i: Invoice, base: string, txUrl?: string) => ({ ...simple(i, "💸 Advance sent", `${usd(i.advance?.amount ?? "0")} USDC`, base), ...(txUrl ? { buttons: [{ text: "🔎 Transaction", url: txUrl }, open(i, base)] } : {}) });
export const reminderSent = (i: Invoice, step: string, base: string) => simple(i, "🔔 Reminder sent to buyer", `${e(i.buyer_label)} · ${e(step)}`, base);
export type ReminderStep = "T-7" | "T-1" | "D0" | "T+1" | "T+7";
export function buyerReminder(i: Invoice, step: ReminderStep, base: string, dueLabel: string, contractDay: string): TelegramCard {
  const labels = { "T-7": "payment due in 7 days", "T-1": "payment due in 1 day", D0: "payment due today", "T+1": "payment overdue by 1 day", "T+7": "payment overdue by 7 days" };
  const outstanding = BigInt(i.face) - BigInt(i.paid.total) + BigInt(i.paid.overpaid);
  return { text: `${header(labels[step], i.id)}\n\n<b>🧾 Invoice</b>\nFrom ${e(i.exporter)} · ${usd(i.face)} USDC\n\n<b>💳 Outstanding</b>\n${usd(outstanding.toString())} · due ${e(dueLabel)} (contract day ${e(contractDay)})\n\n<blockquote>Pay from any chain. Exactly the outstanding amount lands in the invoice contract.</blockquote>`, buttons: [{ text: "💳 Pay now", url: url(base, `/pay/${encodeURIComponent(i.id)}`) }, { text: "➗ Pay part", url: url(base, `/pay/${encodeURIComponent(i.id)}?part=1`) }] };
}
const split = (p: Paid) => `pool ${usd((BigInt(p.to_pool_principal) + BigInt(p.to_pool_fee)).toString())} · protocol ${usd(p.to_protocol)} · you ${usd(p.to_exporter)}`;
export const paymentReceived = (i: Invoice, p: Paid, amount: string, part: number, totalParts: number, via: string, base: string) => simple(i, "💵 Payment received", `${usd(amount)} of ${usd(i.face)} via ${e(via)} · Payment ${e(part)} of ${e(totalParts)}\nSplit: ${split(p)}`, base, true);
export const repaid = (i: Invoice, oldScore: number, newScore: number, rateBps: number, base: string) => simple(i, "🎉 Repaid", `Split: ${split(i.paid)}\nBuyer score ${e(oldScore)} → ${e(newScore)} (next rate ${e(rateBps / 100)}%)`, base, true);
export const overdue = (i: Invoice, days: number, base: string) => simple(i, "🟠 Overdue", `${e(i.id)} is ${e(days)} ${days === 1 ? "day" : "days"} late · reminders continue`, base);
export const defaulted = (i: Invoice, writtenOff: string, base: string) => simple(i, "🔴 Defaulted", `${e(i.id)} · buyer frozen · pool wrote off ${usd(writtenOff)}`, base);
export const lpSharePrice = (before: string, after: string, base: string): TelegramCard => ({ text: `<b>Tradewind</b> · 📈 Share price ${e(formatSharePrice(before))} → ${e(formatSharePrice(after))}`, buttons: [{ text: "📈 Pool", url: url(base, "/pool") }] });
