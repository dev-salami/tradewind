import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openAutomationStore } from "@tradewind/core/automation-store";
import { makeFixtures, type Invoice } from "@tradewind/core";
import { forwardPayment, relayerForward, type RelayerDependencies } from "../src/relayer";
// @ts-expect-error Dependency-free JavaScript simulator
import { startFakeOneClick } from "../../../scripts/fake-oneclick.mjs";
import { OneClickClient, buildRepayQuote, ORIGIN_ASSETS } from "@tradewind/core";
let s: ReturnType<typeof openAutomationStore>, invoice: Invoice, deps: RelayerDependencies;
let providerStatus: string;
const send = vi.fn(async () => "fake-forward-tx");
beforeEach(() => {
  s = openAutomationStore(":memory:"); send.mockClear(); providerStatus = "SUCCESS";
  s.db.exec(`CREATE TABLE payment_intents(pid TEXT PRIMARY KEY, invoice_id TEXT, path TEXT, network TEXT, oneclick_status TEXT, deposit_address TEXT, deposit_memo TEXT, quote_json TEXT, settled_tx TEXT);
    INSERT INTO payment_intents VALUES ('pid','invoice','B','sandbox','PENDING_DEPOSIT','fake-deposit',NULL,'{}',NULL);`);
  invoice = structuredClone(makeFixtures().invoices[0]); invoice.status = "Accepted"; invoice.face = "100"; invoice.paid.total = "0"; invoice.paid.overpaid = "0"; invoice.payments = [];
  deps = { env: { SETTLEMENT_PATH: "B", RELAYER_ACCOUNT_ID: "relayer.test.near", RELAYER_PRIVATE_KEY: "not-a-key-never-parsed", NEAR_NETWORK: "sandbox", ONECLICK_BASE_URL: "http://127.0.0.1:4444" }, invoice: async () => invoice, forward: send, fetch: vi.fn(async () => Response.json({ status: providerStatus, quoteResponse: { quote: { amountOut: "120" } } })) as typeof fetch, log: vi.fn() };
});
afterEach(() => s.db.close());
const row = () => s.db.prepare("SELECT * FROM relayer_forwards WHERE pid='pid'").get();
describe("Trusted settlement relayer job", () => {
  it("forwards exactly once across three ticks and confirms from chain", async () => {
    await relayerForward(s, deps, 1); expect(row()).toMatchObject({ state: "sent", amount_e6: "100", tx_hash: "fake-forward-tx" });
    await relayerForward(s, deps, 2);
    invoice.payments.push({ payment_ref: "pid", amount: "100", at: "0", sender: "relayer.test.near" });
    await relayerForward(s, deps, 3); expect(row()?.state).toBe("confirmed"); expect(send).toHaveBeenCalledExactlyOnceWith(100n, "invoice", "pid");
    expect(s.db.prepare("SELECT settled_tx FROM payment_intents").get()?.settled_tx).toBe("fake-forward-tx");
  });
  it("does not resend a crashed planned claim; ages it to review", async () => {
    await relayerForward(s, deps, 1); send.mockClear();
    s.db.prepare("UPDATE relayer_forwards SET state='planned', tx_hash=NULL").run();
    await relayerForward(s, deps, 2); expect(row()?.state).toBe("planned");
    await relayerForward(s, deps, 600001); expect(row()?.state).toBe("review");
    await relayerForward(s, deps, 900000); expect(send).not.toHaveBeenCalled();
  });
  it("ages sent rows to review without resending, but can still confirm", async () => {
    await relayerForward(s, deps, 1); await relayerForward(s, deps, 600001); expect(row()?.state).toBe("review");
    invoice.payments.push({ payment_ref: "pid", amount: "100", at: "0", sender: "relayer.test.near" });
    await relayerForward(s, deps, 700000); expect(row()?.state).toBe("confirmed"); expect(send).toHaveBeenCalledTimes(1);
  });
  it("holds repaid invoices", async () => { invoice.status = "Repaid"; await relayerForward(s, deps, 1); expect(row()?.state).toBe("held"); expect(send).not.toHaveBeenCalled(); });
  it("makes uncertain sends review-only", async () => { const forward = vi.fn(async () => { throw new Error("RPC lost"); }); await relayerForward(s, { ...deps, forward }, 1); await relayerForward(s, { ...deps, forward }, 2); expect(row()?.state).toBe("review"); expect(forward).toHaveBeenCalledTimes(1); });
  it("persists the planned claim before sending", async () => { await relayerForward(s, { ...deps, forward: async () => { expect(row()?.state).toBe("planned"); return "hash"; } }, 1); });
  it("concurrent ticks cannot claim twice", async () => { await Promise.all([relayerForward(s, deps, 1), relayerForward(s, deps, 1)]); expect(send).toHaveBeenCalledTimes(1); });
  it.each([{}, { SETTLEMENT_PATH: "A" }, { SETTLEMENT_PATH: "B", RELAYER_ACCOUNT_ID: "relayer.test.near" }, { SETTLEMENT_PATH: "B", RELAYER_PRIVATE_KEY: "not-a-key" }])("skips missing environment %j", async env => { await relayerForward(s, { ...deps, env }); expect(send).not.toHaveBeenCalled(); expect(deps.fetch).not.toHaveBeenCalled(); });
  it("refuses mainnet even with an injectable forward", async () => {
    await relayerForward(s, { ...deps, env: { ...deps.env, NEAR_NETWORK: "mainnet" } }); expect(send).not.toHaveBeenCalled(); expect(deps.fetch).not.toHaveBeenCalled();
    await expect(forwardPayment({ NEAR_NETWORK: "mainnet" }, 1n, "invoice", "pid")).rejects.toThrow("refuses mainnet");
  });
  it.each(["INCOMPLETE_DEPOSIT", "REFUNDED", "FAILED"])("never forwards %s", async value => { providerStatus = value; await relayerForward(s, deps, 1); expect(send).not.toHaveBeenCalled(); });
  it("isolates poll failures without signing", async () => { await relayerForward(s, { ...deps, fetch: vi.fn(async () => { throw new Error("offline"); }) }, 1); expect(send).not.toHaveBeenCalled(); });
  it("runs the real transport against the localhost fake through chain confirmation", async () => {
    const fake = await startFakeOneClick({ port: 0, polls: 3 });
    try {
      const quote = await new OneClickClient(fake.baseUrl).quote(buildRepayQuote({ invoiceId: "invoice", amountUnits: "100", outstandingUnits: "100", minPayment: "1", originAsset: ORIGIN_ASSETS.Base.assetId, refundTo: `0x${"1".repeat(40)}`, recipient: "core.test.near", paymentRef: "pid", path: "B", relayer: "relayer.test.near", dry: false }));
      s.db.prepare("UPDATE payment_intents SET deposit_address=?, quote_json=?").run(quote.quote.depositAddress!, JSON.stringify(quote));
      const forward = vi.fn(async (amount: bigint, _id: string, pid: string) => {
        invoice.payments.push({ amount: String(amount), payment_ref: pid, sender: "relayer.test.near", at: "0" }); return "fake-chain-tx";
      });
      const local = { ...deps, env: { ...deps.env, ONECLICK_SIMULATOR: "1", ONECLICK_BASE_URL: fake.baseUrl }, fetch: fetch, forward };
      for (let now = 1; now <= 5; now++) await relayerForward(s, local, now);
      expect(forward).toHaveBeenCalledExactlyOnceWith(100n, "invoice", "pid"); expect(row()).toMatchObject({ state: "confirmed", tx_hash: "fake-chain-tx" });
    } finally { await fake.close(); }
  });
  it("refuses nonlocal simulator URLs", async () => {
    await relayerForward(s, { ...deps, env: { ...deps.env, ONECLICK_SIMULATOR: "1", ONECLICK_BASE_URL: "https://1click.chaindefuser.com" } });
    expect(deps.fetch).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
});
