import { advanceReady, approveState, explorerTx, type AdvancePreview, type BuyerRecord, type Invoice, type TelegramCard } from "@tradewind/core";
import type { AutomationStore } from "@tradewind/core/automation-store";
export interface ApprovalDependencies {
  invoice(id: string): Promise<Invoice | null>;
  preview(id: string): Promise<AdvancePreview>;
  buyer(account: string): Promise<BuyerRecord | null>;
  approver(account: string): Promise<string | null>;
  send(id: string, terms: string, amount: string): Promise<string>;
  botAccount: string; base: string; network: "testnet" | "mainnet" | "sandbox";
}
export async function makeApproveCard(s: AutomationStore, d: ApprovalDependencies, i: Invoice, changed = false): Promise<TelegramCard> {
  const [p, b, approver] = await Promise.all([d.preview(i.id), d.buyer(i.buyer), d.approver(i.exporter)]);
  const link = s.link(i.exporter);
  // Unverified development links are notification-only and never authorise spending.
  const optedIn = !!link?.verified && !!d.botAccount && approver === d.botAccount;
  const bound = { invoice_id: i.id, terms_hash: i.terms_hash, amount_e6: p.advance, tg_user_id: link?.tg_user_id ?? "" };
  const tokens = link ? { approve: s.issueCallback({ ...bound, action: "approve" }), skip: s.issueCallback({ ...bound, action: "skip" }) } : undefined;
  const card = advanceReady(i, p, b, d.base, tokens, changed);
  if (!optedIn) card.buttons = card.buttons.map(button => button.text === "✅ Approve advance" ? { text: button.text, url: `${d.base}/app/i/${encodeURIComponent(i.id)}?advance=1` } : button);
  return card;
}
export async function handleCallback(s: AutomationStore, d: ApprovalDependencies, token: string, user: string, now = Date.now()): Promise<TelegramCard> {
  const t = s.callback(token);
  if (!t || t.tg_user_id !== user || t.used_at !== null || t.expires_at <= now) throw new Error("Invalid or expired button. Open the invoice.");
  const i = await d.invoice(t.invoice_id);
  const link = i && s.link(i.exporter);
  if (!i || !link || link.tg_user_id !== user) throw new Error("This button belongs to another user.");
  // Atomic claim BEFORE RPC/signing. A failed or uncertain send must never be retried by double tap.
  if (!s.consumeCallback(token, user, now)) throw new Error("Button already used.");
  if (t.action === "skip") { s.audit("telegram_skip", i.id, user, null, "skipped"); return approveState(i, "skipped", d.base); }
  s.audit("telegram_approval", i.id, user, null, "claimed");
  try {
    const p = await d.preview(i.id);
    if (i.terms_hash !== t.terms_hash || p.advance !== t.amount_e6 || !p.eligible || i.status !== "Accepted") {
      s.audit("telegram_approval", i.id, user, null, "terms_changed"); return makeApproveCard(s, d, i, true);
    }
    if (!link.verified || !d.botAccount || await d.approver(i.exporter) !== d.botAccount) {
      s.audit("telegram_approval", i.id, user, null, "wallet_required"); return makeApproveCard(s, d, i);
    }
    const tx = await d.send(i.id, t.terms_hash, t.amount_e6);
    s.audit("telegram_approval", i.id, user, tx, "sent");
    s.db.prepare("INSERT OR IGNORE INTO automation_receipts VALUES (?, ?, ?)").run(i.id, tx, "Telegram advance approval");
    return approveState(i, "sent", d.base, tx, explorerTx(d.network, tx) ?? "");
  } catch (error) { s.audit("telegram_approval", i.id, user, null, "failed_or_unknown; check invoice before retry"); throw error; }
}
