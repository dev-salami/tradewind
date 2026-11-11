// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { openAutomationStore, drainOutbox, type AutomationStore } from "../src/automation-store";
const stores: AutomationStore[] = [];
const create = () => { const s = openAutomationStore(":memory:"); stores.push(s); return s; };
afterEach(() => { for (const s of stores.splice(0)) s.db.close(); });
describe("callback/code lifecycle", () => {
  it("uses random 128-bit codes with one-time consumption and 10-minute expiry", () => {
    const s = create(), code = s.issueCode("sample.testnet", "buyer", false, 1000);
    expect(code).toMatch(/^[0-9a-f]{32}$/);
    expect(s.consumeCode(code, "123", "123", 2000)).toBe(true);
    expect(s.consumeCode(code, "123", "123", 2000)).toBe(false);
    expect(s.link("sample.testnet", "buyer")?.verified).toBe(0);
    const expired = s.issueCode("sample.testnet", "buyer", false, 0);
    expect(s.consumeCode(expired, "123", "123", 600_000)).toBe(false);
  });
  it("binds the user, terms and amount; atomically consumes once at most; expires at 30 minutes", () => {
    const s = create();
    const data = { invoice_id: "TW-0042", action: "approve" as const, terms_hash: "terms", amount_e6: "8000000", tg_user_id: "123" };
    const token = s.issueCallback(data, 0);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(s.consumeCallback(token, "other", 1)).toBeUndefined();
    expect(s.consumeCallback(token, "123", 1)).toMatchObject(data);
    expect(s.consumeCallback(token, "123", 2)).toBeUndefined();
    expect(s.consumeCallback(s.issueCallback(data, 0), "123", 1_800_000)).toBeUndefined();
  });
});
describe("outbox", () => {
  it("deduplicates and retains identical in-app cards with skipped_no_token", async () => {
    const s = create(), card = { text: "<b>Tradewind</b>", buttons: [] };
    s.enqueue("sample.testnet", "checked", card, "unique"); s.enqueue("sample.testnet", "checked", card, "unique");
    const send = vi.fn(); await drainOutbox(s, undefined, send);
    expect(send).not.toHaveBeenCalled();
    expect(s.db.prepare("SELECT status, payload, attempts FROM notifications_outbox").all()).toEqual([{ status: "skipped_no_token", payload: JSON.stringify(card), attempts: 0 }]);
  });
  it("backs off and stops after five attempts", async () => {
    const s = create(); s.db.prepare("INSERT INTO telegram_links VALUES (?, ?, ?, ?, ?, ?)").run("sample.testnet", "123", "123", "exporter", 0, 0);
    s.enqueue("sample.testnet", "checked", { text: "card", buttons: [] }, "unique", "exporter", 0);
    const send = vi.fn().mockRejectedValue(new Error("offline"));
    await drainOutbox(s, "configured", send, 0);
    await drainOutbox(s, "configured", send, 999);
    expect(send).toHaveBeenCalledTimes(1);
    for (const now of [1000, 3000, 7000, 15000, 999999]) await drainOutbox(s, "configured", send, now);
    expect(send).toHaveBeenCalledTimes(5);
    expect(s.db.prepare("SELECT status, attempts FROM notifications_outbox").get()).toEqual({ status: "failed", attempts: 5 });
  });
  it("records success and never resends", async () => {
    const s = create(); s.db.prepare("INSERT INTO telegram_links VALUES (?, ?, ?, ?, ?, ?)").run("sample.testnet", "123", "123", "exporter", 0, 0);
    s.enqueue("sample.testnet", "checked", { text: "card", buttons: [] }, "unique");
    const send = vi.fn().mockResolvedValue({}); await drainOutbox(s, "configured", send); await drainOutbox(s, "configured", send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(s.db.prepare("SELECT status FROM notifications_outbox").get()?.status).toBe("sent");
  });
});
