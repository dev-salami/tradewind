// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { repository } from "../src/server/db";
import { POST as notify } from "../src/app/api/tx/notify/route";
import { POST as profile, GET as account } from "../src/app/api/accounts/route";
import { createSessionToken } from "../src/server/auth/session";
const mocks = vi.hoisted(() => ({ store: vi.fn(), status: vi.fn() }));
vi.mock("../src/server/db", async original => ({ ...await original<typeof import("../src/server/db")>(), store: mocks.store }));
vi.mock("../src/lib/near", () => ({ txStatus: mocks.status, coreId: () => "core.testnet", usdcId: () => "usdc.testnet" }));
const hash = "A".repeat(44);
const request = (path: string, body: unknown) => new Request(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) });
afterEach(() => vi.clearAllMocks());
describe("wallet metadata routes (no signing keys, no network)", () => {
  it("stores notification idempotently and parses an FT repayment invoice id", async () => {
    const repo = repository(":memory:"); mocks.store.mockReturnValue(repo);
    try {
      mocks.status.mockResolvedValue({ transaction: { hash, signer_id: "buyer.testnet", receiver_id: "usdc.testnet", actions: [{ FunctionCall: { method_name: "ft_transfer_call", args: Buffer.from(JSON.stringify({ receiver_id: "core.testnet", msg: JSON.stringify({ action: "repay", invoice_id: "TW-0042" }) })).toString("base64") } }] } });
      const body = { tx_hash: hash, account_id: "buyer.testnet" };
      expect((await notify(request("/api/tx/notify", body))).status).toBe(200);
      expect(await (await notify(request("/api/tx/notify", body))).json()).toMatchObject({ invoice_id: "TW-0042" });
      expect(repo.db.prepare("SELECT tx_hash, invoice_id FROM tx_log").all()).toEqual([{ tx_hash: hash, invoice_id: "TW-0042" }]);
      expect(repo.txsForInvoice("TW-0042")[0]).toMatchObject({ method: "ft_transfer_call", kind: "repay" });
    } finally { repo.db.close(); }
  });
  it("retains a pending hash on RPC outage and rejects malformed or wrong signer input", async () => {
    const repo = repository(":memory:"); mocks.store.mockReturnValue(repo);
    try {
      expect((await notify(request("/api/tx/notify", { tx_hash: "bad" }))).status).toBe(400);
      mocks.status.mockRejectedValueOnce(new Error("RPC unavailable"));
      expect((await notify(request("/api/tx/notify", { tx_hash: hash, account_id: "buyer.testnet" }))).status).toBe(503);
      expect(repo.db.prepare("SELECT invoice_id FROM tx_log").get()?.invoice_id).toBeNull();
      mocks.status.mockResolvedValue({ transaction: { signer_id: "other.testnet", receiver_id: "core.testnet" } });
      expect((await notify(request("/api/tx/notify", { tx_hash: hash, account_id: "buyer.testnet" }))).status).toBe(400);
    } finally { repo.db.close(); }
  });
  it("saves display metadata only with a same-origin session for the same account", async () => {
    const repo = repository(":memory:"); mocks.store.mockReturnValue(repo);
    vi.stubEnv("SESSION_SECRET", "s".repeat(40)); vi.stubEnv("PUBLIC_BASE_URL", "http://localhost");
    const authed = (body: unknown, account = "exporter.testnet", origin = "http://localhost") => new Request("http://localhost/api/accounts", { method: "POST", headers: { origin, cookie: `tw_session=${createSessionToken(account)}` }, body: JSON.stringify(body) });
    try {
      const body = { account_id: "exporter.testnet", display_name: "Sample exporter", country: "NG" };
      expect((await profile(new Request("http://localhost/api/accounts", { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify(body) }))).status).toBe(401);
      expect((await profile(authed(body, "someone.testnet"))).status).toBe(403);
      expect((await profile(authed(body, "exporter.testnet", "http://other.test"))).status).toBe(403);
      expect((await profile(authed(body))).status).toBe(200);
      expect(await (await account(new Request("http://localhost/api/accounts?account_id=exporter.testnet"))).json()).toEqual({ registered: true });
      expect(repo.getAccount("exporter.testnet")?.display_name).toBe("Sample exporter");
      expect((await profile(authed({ ...body, display_name: "" }))).status).toBe(400);
    } finally { repo.db.close(); vi.unstubAllEnvs(); }
  });
});
