import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixtureData, type Invoice } from "@tradewind/core";
import { encryptGuidedKey, type GuidedSession } from "../../web/src/server/guided/session-store";
import { guidedCleanupCall } from "../src/guided-near";

const mocks = vi.hoisted(() => ({ view: vi.fn(), call: vi.fn(), key: vi.fn() }));
vi.mock("near-api-js", () => ({
  KeyPair: { fromString: (key: string) => key },
  keyStores: { InMemoryKeyStore: class { setKey(...args: unknown[]) { mocks.key(...args); } } },
  connect: async () => ({ connection: {} }),
  Account: class {
    constructor(_connection: unknown, readonly accountId: string) {}
    viewFunction(args: unknown) { return mocks.view(args); }
    functionCall(args: unknown) { return mocks.call(this.accountId, args); }
  },
}));
let invoice: Invoice, session: GuidedSession;
beforeEach(async () => {
  vi.stubEnv("NEAR_NETWORK", "sandbox"); vi.stubEnv("NEAR_RPC_URL", "http://localhost:3039");
  vi.stubEnv("GUIDED_ENABLED", "1"); vi.stubEnv("CORE_CONTRACT_ID", "core.test.near"); vi.stubEnv("USDC_CONTRACT_ID", "usdc.test.near");
  vi.stubEnv("SESSION_SECRET", "test-only-secret-at-least-thirty-two-bytes");
  invoice = (await fixtureData({ stage: "Funded" }).getInvoice("TW-0042"))!;
  vi.stubEnv("GUIDED_EXPORTER_ACCOUNT_ID", invoice.exporter); vi.stubEnv("GUIDED_EXPORTER_PRIVATE_KEY", "exporter-key");
  vi.stubEnv("OWNER_ACCOUNT_ID", "owner.test.near"); vi.stubEnv("OWNER_PRIVATE_KEY", "owner-key");
  session = { session_id: "a".repeat(32), buyer_account: invoice.buyer, encrypted_key: encryptGuidedKey("session-key"), created_at: 0, last_invoice_id: invoice.id, invoice_count: 1, ready: 1 };
  mocks.call.mockResolvedValue({ transaction: { hash: "cleanup-hash" }, status: { SuccessValue: "" } });
  mocks.view.mockImplementation(async ({ methodName }: { methodName: string }) => methodName === "ft_balance_of" ? "0" : invoice);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden"); }));
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it.each(["Created", "Verified", "Accepted"] as const)("cancels %s as exporter without requiring owner credentials", async status => {
  invoice = { ...invoice, status, advance: null };
  vi.stubEnv("OWNER_PRIVATE_KEY", "");
  expect(await guidedCleanupCall("cancel", invoice, session)).toBe("cleanup-hash");
  expect(mocks.call).toHaveBeenCalledWith(invoice.exporter, expect.objectContaining({ methodName: "cancel_invoice", args: { id: invoice.id }, attachedDeposit: 0n }));
  expect(mocks.key).toHaveBeenCalledWith("sandbox", invoice.exporter, "exporter-key");
});
it("supports explicit one-yocto and owner-only compatibility rejections", async () => {
  invoice = { ...invoice, status: "Accepted", advance: null };
  mocks.call.mockRejectedValueOnce(new Error("owner only")).mockRejectedValueOnce(new Error("Requires attached deposit of exactly 1 yoctoNEAR"));
  expect(await guidedCleanupCall("cancel", invoice, session)).toBe("cleanup-hash");
  expect(mocks.call).toHaveBeenLastCalledWith("owner.test.near", expect.objectContaining({ attachedDeposit: 1n }));
});
it("mints only the shortfall, repays fully as the session buyer and confirms Repaid", async () => {
  invoice = { ...invoice, status: "PartiallyPaid", paid: { ...invoice.paid, total: "6000000", overpaid: "0" } };
  let reads = 0;
  mocks.view.mockImplementation(async ({ methodName }: { methodName: string }) => methodName === "ft_balance_of" ? "1000000" : ++reads === 1 ? invoice : { ...invoice, status: "Repaid" });
  await guidedCleanupCall("repay", invoice, session);
  expect(mocks.key).toHaveBeenCalledWith("sandbox", invoice.buyer, "session-key");
  expect(mocks.call).toHaveBeenCalledWith(invoice.buyer, expect.objectContaining({ methodName: "mint", args: { account_id: invoice.buyer, amount: "3000000" } }));
  expect(mocks.call).toHaveBeenLastCalledWith(invoice.buyer, expect.objectContaining({ methodName: "ft_transfer_call", args: expect.objectContaining({ amount: "4000000" }), attachedDeposit: 1n, gas: 300_000_000_000_000n }));
});
it("refuses mainnet without signing", async () => {
  vi.stubEnv("NEAR_NETWORK", "mainnet");
  await expect(guidedCleanupCall("repay", invoice, session)).rejects.toThrow("disabled");
  expect(mocks.call).not.toHaveBeenCalled();
});
it("preserves missing-method failures for the cleanup job's guarded fallback", async () => {
  invoice = { ...invoice, status: "Verified", advance: null };
  mocks.call.mockResolvedValue({ transaction: { hash: "failed-hash" }, status: { Failure: { MethodNotFound: { method_name: "cancel_invoice" } } } });
  await expect(guidedCleanupCall("cancel", invoice, session)).rejects.toThrow("MethodNotFound");
});
