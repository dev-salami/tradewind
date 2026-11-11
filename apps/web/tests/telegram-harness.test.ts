// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAutomationStore, type AutomationStore } from "@tradewind/core/automation-store";
import { applyWaterfall, makeFixtures, type AdvancePreview, type Invoice } from "@tradewind/core";
import { makeApproveCard } from "../src/server/telegram/callbacks";
import type { JobDependencies } from "../../worker/src/jobs";
import { telegramApiRoot } from "../src/server/telegram/config";
// The fixture server is intentionally a dependency-free, importable JS module.
// @ts-expect-error JS fixture has no declaration file
import { startFakeTelegram } from "../../../scripts/fake-telegram.mjs";

const injected = vi.hoisted(() => ({ store: null as unknown as AutomationStore, deps: null as unknown as JobDependencies }));
vi.mock("../src/server/telegram/store", () => ({ telegramStore: () => injected.store }));
vi.mock("../src/server/telegram/dependencies", () => ({ approvalDependencies: () => injected.deps }));
vi.mock("../src/server/telegram/near", () => ({ view: (method: string) => method === "get_pool" ? injected.deps.pool() : injected.deps.list(0) }));

interface Call { method: string; params: { text?: string; chat_id?: string | number; show_alert?: boolean; reply_markup?: { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] } } }
let fake: { url: string; calls: Call[]; pushUpdate: (update: unknown, url: string, secret: string) => Promise<Response>; close: () => Promise<void> };
let server: Server, webhook: string, dir: string, s: AutomationStore, d: JobDependencies, invoice: Invoice;
let updateId = 0;
const messages = () => fake.calls.filter(c => c.method === "sendMessage");
const answers = () => fake.calls.filter(c => c.method === "answerCallbackQuery");
async function post(update: object, secret = "fixture-secret") {
  const response = await fake.pushUpdate({ update_id: ++updateId, ...update }, webhook, secret);
  expect(response.status).toBe(200);
}
const command = (text: string) => post({ message: { message_id: ++updateId, date: 1, chat: { id: 123, type: "private" }, from: { id: 123, is_bot: false, first_name: "Fixture" }, text, entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] } });
const tap = (data: string) => post({ callback_query: { id: `tap-${++updateId}`, from: { id: 123, is_bot: false, first_name: "Fixture" }, chat_instance: "fixture", data, message: { message_id: 1, date: 1, chat: { id: 123, type: "private" }, text: "Card" } } });
async function card(changed = false) {
  const c = await makeApproveCard(s, d, invoice, changed);
  s.enqueue(invoice.exporter, "advance_ready", c, `card-${updateId++}`);
  const { flushNotifications } = await import("../src/server/telegram/notify");
  await flushNotifications(s);
  return c;
}
beforeEach(async () => {
  vi.resetModules();
  fake = await startFakeTelegram({ port: 0 });
  vi.stubEnv("TELEGRAM_API_ROOT", process.env.TELEGRAM_DEMO_API_ROOT || fake.url);
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "000000:FAKE");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "fixture-secret");
  dir = mkdtempSync(join(tmpdir(), "telegram-harness-"));
  s = openAutomationStore(join(dir, "automation.sqlite"));
  const fixtures = makeFixtures("Accepted");
  invoice = structuredClone(fixtures.invoices.find(i => i.id === "TW-0042")!);
  const preview: AdvancePreview = { advance: "8000000", rate_bps: 8000, pool_fee: "150000", protocol_fee: "50000", exporter_rest: "1800000", eligible: true, reason: null };
  d = { invoice: async () => invoice, preview: vi.fn(async () => preview), buyer: async account => fixtures.buyerRecord(account), approver: async () => "fixture-bot.testnet", send: vi.fn(async () => "fixture-tx"), botAccount: "fixture-bot.testnet", base: "http://localhost:3000", network: "sandbox", list: async from => from ? [] : [invoice], pool: async () => ({ ...fixtures.pool, total_assets: "1234560000", share_price_e6: "1023400" }), config: async () => fixtures.config, keeper: vi.fn(), keeperConfigured: false };
  injected.store = s; injected.deps = d;
  const { POST } = await import("../src/app/api/telegram/webhook/route");
  server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = await POST(new Request(`http://localhost/api/telegram/webhook`, { method: "POST", headers: req.headers as Record<string, string>, body: Buffer.concat(chunks).toString() }));
      res.writeHead(response.status, { "content-type": "application/json" }); res.end(await response.text());
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing listener");
  webhook = `http://127.0.0.1:${address.port}/api/telegram/webhook`;
});
afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await fake.close(); s.db.close(); rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs(); vi.restoreAllMocks();
});
async function link() { await command(`/start ${s.issueCode(invoice.exporter, "exporter", true)}`); }

describe("local Telegram Bot API harness", () => {
  it("validates API roots without network access", () => {
    expect(telegramApiRoot("https://api.telegram.org")).toBe("https://api.telegram.org");
    for (const root of [fake.url, "http://localhost:8081", "http://[::1]:8081"]) expect(telegramApiRoot(root)).toBe(root);
    for (const root of ["http://example.test", "ftp://localhost", "http://localhost.evil", "https://user:pass@example.test"]) expect(() => telegramApiRoot(root)).toThrow();
  });
  it("links once, explains wallet opt-in, and rejects wrong and expired codes", async () => {
    await link();
    expect(s.link(invoice.exporter)?.tg_chat_id).toBe("123");
    expect(messages().at(-1)?.params.text).toContain("notifications and reminders");
    expect(messages().at(-1)?.params.text).toContain("wallet opt-in");
    await command("/start wrong");
    expect(messages().at(-1)?.params.text).toContain("expired or invalid");
    const expired = s.issueCode("expired.testnet", "exporter", false, Date.now() - 700_000);
    await command(`/start ${expired}`);
    expect(messages().at(-1)?.params.text).toContain("expired or invalid");
    expect(s.link("expired.testnet")).toBeUndefined();
  });
  it("delivers keyboards, handles secret-checked approval, and rejects replay and concurrent taps", async () => {
    await link();
    const c = await card();
    const sent = messages().at(-1)!;
    expect(String(sent.params.chat_id)).toBe("123");
    expect(sent.params.reply_markup?.inline_keyboard.flat()).toEqual(c.buttons);
    for (const b of c.buttons) if (b.callback_data) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    const response = await fake.pushUpdate({ update_id: ++updateId }, webhook, "wrong");
    expect(response.status).toBe(401);
    expect(d.send).not.toHaveBeenCalled();
    await tap(c.buttons[0].callback_data!);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(fake.calls.some(c => c.method === "editMessageText" && c.params.text?.includes("💸 Sent"))).toBe(true);
    await tap(c.buttons[0].callback_data!);
    expect(answers().at(-1)?.params).toMatchObject({ text: expect.stringContaining("Button unavailable"), show_alert: true });
    expect(d.send).toHaveBeenCalledTimes(1);
    const next = await card();
    await Promise.all([tap(next.buttons[0].callback_data!), tap(next.buttons[0].callback_data!)]);
    expect(d.send).toHaveBeenCalledTimes(2);
  });
  it("rejects expired tokens and revokes ALL old unused tokens on changed terms", async () => {
    await link();
    const expired = await card();
    s.db.prepare("UPDATE telegram_callbacks SET expires_at=?").run(Date.now() - 1);
    await tap(expired.buttons[0].callback_data!);
    expect(answers().at(-1)?.params.show_alert).toBe(true);
    expect(d.send).not.toHaveBeenCalled();
    const old = await card(), older = await card();
    invoice = { ...invoice, terms_hash: "changed-fixture-terms" };
    const preview = await d.preview(invoice.id);
    d.preview = async () => ({ ...preview, advance: "7000000" });
    const fresh = await card(true);
    for (const c of [old, older]) for (const b of c.buttons.filter(b => b.callback_data)) {
      expect(s.callback(b.callback_data!)?.used_at).not.toBeNull();
      await tap(b.callback_data!);
      expect(answers().at(-1)?.params.show_alert).toBe(true);
    }
    expect(d.send).not.toHaveBeenCalled();
    await tap(fresh.buttons[0].callback_data!);
    expect(d.send).toHaveBeenCalledExactlyOnceWith(invoice.id, invoice.terms_hash, "7000000");
  });
  it("indexes 0 → 1 → 3 payments, enqueues each part once and delivers without duplicates", async () => {
    await link();
    const { indexer } = await import("../../worker/src/jobs");
    const { flushNotifications } = await import("../src/server/telegram/notify");
    invoice = structuredClone(makeFixtures("Funded").invoices.find(i => i.id === invoice.id)!);
    const run = () => indexer(s, d, invoice.accepted_at!);
    await run();
    for (let count = 1; count <= 3; count++) {
      const result = applyWaterfall(invoice, 2_000_000n);
      invoice = { ...invoice, paid: result.paid, status: result.status, payments: [...invoice.payments, { amount: "2000000", at: invoice.accepted_at!, sender: invoice.buyer, payment_ref: `fixture-part-${count}` }] };
      if (count !== 2) { await run(); await run(); }
    }
    const rows = s.db.prepare("SELECT payload FROM notifications_outbox WHERE kind LIKE 'payment_received:%' ORDER BY id").all();
    expect(rows).toHaveLength(3);
    for (const [index, total] of [[1, 1], [2, 3], [3, 3]]) expect(String(rows[index - 1].payload)).toContain(`Payment ${index} of ${total}`);
    await flushNotifications(s); await run(); await flushNotifications(s);
    expect(messages().filter(c => c.params.text?.includes("Payment received"))).toHaveLength(3);
  });
  it("sends buyer and exporter reminders once per core-defined step", async () => {
    await link();
    s.consumeCode(s.issueCode(invoice.buyer, "buyer", true), "456", "456");
    const { reminders } = await import("../../worker/src/jobs");
    const { flushNotifications } = await import("../src/server/telegram/notify");
    const config = await d.config(), day = BigInt(config.seconds_per_day) * 1_000_000_000n;
    for (const offset of [-7, -1, 0, 1, 7]) {
      const now = (BigInt(invoice.due_at!) + BigInt(offset) * day).toString();
      reminders(s, d, [invoice], now, config); reminders(s, d, [invoice], now, config);
    }
    expect(s.db.prepare("SELECT * FROM reminders").all()).toHaveLength(5);
    await flushNotifications(s); await flushNotifications(s);
    expect(messages().filter(c => String(c.params.chat_id) === "456")).toHaveLength(5);
    expect(messages().filter(c => c.params.text?.includes("Reminder sent to buyer"))).toHaveLength(5);
  });
  it("formats pool human units, filters own invoices, and stops pending callbacks/outbox", async () => {
    await link();
    d.list = async () => [invoice, { ...invoice, id: "FOREIGN", exporter: "other.testnet", buyer: "unrelated.testnet" }];
    await command("/pool");
    expect(messages().at(-1)?.params.text).toBe("Pool assets: 1,234.56 USDC · Share price: 1.0234");
    await command("/invoices");
    expect(messages().at(-1)?.params.text).toContain(invoice.id);
    expect(messages().at(-1)?.params.text).not.toContain("FOREIGN");
    const c = await makeApproveCard(s, d, invoice);
    s.enqueue(invoice.exporter, "pending", c, "stop-pending");
    s.enqueue(invoice.exporter, "pending", c, "stop-before-link");
    s.db.prepare("UPDATE notifications_outbox SET chat_id=NULL WHERE dedupe_key='stop-before-link'").run();
    await command("/stop");
    expect(s.link(invoice.exporter)).toBeUndefined();
    for (const b of c.buttons.filter(b => b.callback_data)) expect(s.callback(b.callback_data!)?.used_at).not.toBeNull();
    const { flushNotifications } = await import("../src/server/telegram/notify");
    const before = messages().length;
    await flushNotifications(s);
    expect(messages()).toHaveLength(before);
    expect(s.db.prepare("SELECT status FROM notifications_outbox WHERE dedupe_key='stop-pending'").get()?.status).toBe("skipped_unlinked");
    expect(s.db.prepare("SELECT status FROM notifications_outbox WHERE dedupe_key='stop-before-link'").get()?.status).toBe("skipped_unlinked");
    await tap(c.buttons[0].callback_data!);
    expect(d.send).not.toHaveBeenCalled();
  });
  it("scripted demo: link, notify, approve, replay, pool, invoices, reminders, payments, stop", async () => {
    await link();
    const c = await card();
    await tap(c.buttons[0].callback_data!); await tap(c.buttons[0].callback_data!);
    expect(d.send).toHaveBeenCalledTimes(1);
    await command("/pool"); await command("/invoices");
    const { indexer, reminders } = await import("../../worker/src/jobs");
    const { flushNotifications } = await import("../src/server/telegram/notify");
    s.consumeCode(s.issueCode(invoice.buyer, "buyer", true), "456", "456");
    reminders(s, d, [invoice], invoice.due_at!, await d.config());
    invoice = structuredClone(makeFixtures("PartiallyPaid").invoices.find(i => i.id === invoice.id)!);
    await indexer(s, d, invoice.due_at!); await flushNotifications(s);
    await command("/stop");
  });
});
