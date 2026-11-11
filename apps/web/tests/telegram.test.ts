// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { openAutomationStore, type AutomationStore } from "@tradewind/core/automation-store";
import { makeFixtures, type AdvancePreview } from "@tradewind/core";
import { handleCallback, makeApproveCard, type ApprovalDependencies } from "../src/server/telegram/callbacks";
import { validWebhookSecret } from "../src/server/telegram/webhook";
import { POST as webhookPost } from "../src/app/api/telegram/webhook/route";
import { getBot } from "../src/server/telegram/bot";
import { signedCall, NotConfiguredError } from "../src/server/telegram/near";
const stores: AutomationStore[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.db.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function setup(verified = true, optedIn = true) {
  const f = makeFixtures("Accepted"), i = f.invoices.find(i => i.id === "TW-0042")!;
  const s = openAutomationStore(":memory:"); stores.push(s);
  s.db.prepare("INSERT INTO telegram_links VALUES (?, ?, ?, ?, ?, ?)").run(i.exporter, "123", "123", "exporter", Number(verified), 0);
  const p: AdvancePreview = { advance: "8000000", rate_bps: 8000, pool_fee: "150000", protocol_fee: "50000", exporter_rest: "1800000", eligible: true, reason: null };
  const d: ApprovalDependencies = { invoice: vi.fn().mockResolvedValue(i), preview: vi.fn().mockResolvedValue(p), buyer: vi.fn().mockResolvedValue(f.buyerRecord(i.buyer)), approver: vi.fn().mockResolvedValue(optedIn ? "bot.testnet" : null), send: vi.fn().mockResolvedValue("tx-hash"), botAccount: "bot.testnet", base: "https://example.test", network: "testnet" };
  const token = () => s.issueCallback({ invoice_id: i.id, action: "approve", terms_hash: i.terms_hash, amount_e6: p.advance, tg_user_id: "123" });
  return { s, d, i, p, token };
}
describe("approval callbacks", () => {
  it("signs once for the linked user, consumes before sending, and audits tx hash", async () => {
    const { s, d, token } = setup(), t = token();
    d.send = vi.fn(async () => { expect(s.callback(t)?.used_at).not.toBeNull(); return "tx-hash"; });
    expect((await handleCallback(s, d, t, "123")).text).toContain("💸 Sent");
    await expect(handleCallback(s, d, t, "123")).rejects.toThrow();
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(String(s.db.prepare("SELECT detail FROM audit_log ORDER BY id DESC LIMIT 1").get()?.detail)).toContain('"tx_hash":"tx-hash"');
  });
  it("rejects wrong users, expired tokens and unlinked users without signing", async () => {
    const { s, d, token } = setup(), t = token();
    await expect(handleCallback(s, d, t, "456")).rejects.toThrow();
    await expect(handleCallback(s, d, t, "123", Date.now() + 1_800_001)).rejects.toThrow();
    s.db.prepare("DELETE FROM telegram_links").run();
    await expect(handleCallback(s, d, t, "123")).rejects.toThrow();
    expect(d.send).not.toHaveBeenCalled();
  });
  it.each(["amount", "hash"])("refreshes changed %s with new tokens and fresh numbers", async field => {
    const { s, d, i, p, token } = setup(), t = token();
    if (field === "amount") d.preview = vi.fn().mockResolvedValue({ ...p, advance: "7000000" });
    else d.invoice = vi.fn().mockResolvedValue({ ...i, terms_hash: "new-terms" });
    const card = await handleCallback(s, d, t, "123");
    expect(card.text).toContain("Terms changed, review again");
    if (field === "amount") expect(card.text).toContain("$7.00 USDC");
    expect(card.buttons[0].callback_data).not.toBe(t);
    expect(d.send).not.toHaveBeenCalled();
    expect(s.callback(t)?.used_at).not.toBeNull();
  });
  it.each([[true, false], [false, true]])("uses wallet URLs when verification=%s and opt-in=%s", async (verified, optedIn) => {
    const { s, d, i, token } = setup(verified, optedIn);
    const card = await makeApproveCard(s, d, i);
    expect(card.buttons[0]).toEqual({ text: "✅ Approve advance", url: "https://example.test/app/i/TW-0042?advance=1" });
    await handleCallback(s, d, token(), "123"); expect(d.send).not.toHaveBeenCalled();
  });
  it("not-now collapses the card without a transaction", async () => {
    const { s, d, i, p } = setup();
    const t = s.issueCallback({ invoice_id: i.id, action: "skip", terms_hash: i.terms_hash, amount_e6: p.advance, tg_user_id: "123" });
    expect((await handleCallback(s, d, t, "123")).text).toBe("Skipped. Advance stays available in the app.");
    expect(d.send).not.toHaveBeenCalled();
  });
  it("does not re-use tokens after failed/uncertain signing", async () => {
    const { s, d, token } = setup(), t = token(); d.send = vi.fn().mockRejectedValue(new Error("uncertain"));
    await expect(handleCallback(s, d, t, "123")).rejects.toThrow();
    await expect(handleCallback(s, d, t, "123")).rejects.toThrow();
    expect(d.send).toHaveBeenCalledTimes(1);
  });
  it("double taps concurrently cannot sign twice", async () => {
    const { s, d, token } = setup(), t = token();
    const outcomes = await Promise.allSettled([handleCallback(s, d, t, "123"), handleCallback(s, d, t, "123")]);
    expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
    expect(d.send).toHaveBeenCalledTimes(1);
  });
});
describe("webhook secret", () => {
  it("requires the secret header and constructs no bot with the token unset", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", ""); vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "expected");
    const fetch = vi.spyOn(globalThis, "fetch");
    expect(getBot()).toBeNull();
    expect((await webhookPost(new Request("https://example.test/api/telegram/webhook", { method: "POST" }))).status).toBe(401);
    const response = await webhookPost(new Request("https://example.test/api/telegram/webhook", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "expected" } }));
    expect(await response.json()).toEqual({ ok: true, status: "skipped_no_token" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fails without bot keys before attempting any RPC", async () => {
    vi.stubEnv("BOT_ACCOUNT_ID", ""); vi.stubEnv("BOT_PRIVATE_KEY", "");
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(signedCall("BOT", "request_advance", {})).rejects.toBeInstanceOf(NotConfiguredError);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects unset, missing, unequal-length and wrong values", () => {
    expect(validWebhookSecret(null, undefined)).toBe(false);
    expect(validWebhookSecret("", "expected")).toBe(false);
    expect(validWebhookSecret("wrong", "expected")).toBe(false);
    expect(validWebhookSecret("expected", "expected")).toBe(true);
  });
});
