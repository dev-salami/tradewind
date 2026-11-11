// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { viewFunction } from "@tradewind/core";
import { createSessionToken } from "../src/server/auth/session";
import { isOwner } from "../src/server/auth/owner";
import { GET } from "../src/app/api/ops/route";
vi.mock("@tradewind/core", () => ({ viewFunction: vi.fn() }));
const request = (account?: string) => new Request("https://app.test/api/ops", { headers: account ? { cookie: `tw_session=${createSessionToken(account)}` } : {} });
beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-only-session-secret-at-least-32-bytes");
  vi.stubEnv("OWNER_ACCOUNT_ID", "owner.testnet");
  vi.stubEnv("NEXT_PUBLIC_DATA_SOURCE", "rpc");
  vi.stubEnv("CORE_CONTRACT_ID", "core.testnet");
  vi.mocked(viewFunction).mockReset();
});
afterEach(() => vi.unstubAllEnvs());
describe("owner session access", () => {
  it("requires an authenticated exact owner session and returns no identity otherwise", async () => {
    vi.mocked(viewFunction).mockResolvedValue({ owner: "owner.testnet" });
    expect(await isOwner(request())).toBe(false);
    expect(await isOwner(request("other.testnet"))).toBe(false);
    expect(await isOwner(request("owner.testnet"))).toBe(true);
    const response = await GET(request("other.testnet"));
    expect(await response.json()).toEqual({ isOwner: false, accountId: null });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("reads get_roles when get_config has no owner and fails closed on RPC errors", async () => {
    vi.mocked(viewFunction).mockResolvedValueOnce({ paused: false }).mockResolvedValueOnce({ owner: "current.testnet" });
    expect(await isOwner(request("current.testnet"))).toBe(true);
    expect(vi.mocked(viewFunction).mock.calls[1][2]).toBe("get_roles");
    vi.mocked(viewFunction).mockRejectedValue(new Error("offline"));
    expect(await isOwner(request("owner.testnet"))).toBe(false);
  });
  it("hides fixtures unless explicitly enabled and still requires the owner", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_SOURCE", "fixtures");
    vi.stubEnv("NEXT_PUBLIC_SHOW_OPS", "0");
    expect(await isOwner(request("owner.testnet"))).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_SHOW_OPS", "1");
    expect(await isOwner(request("owner.testnet"))).toBe(true);
    expect(await isOwner(request("other.testnet"))).toBe(false);
    expect(viewFunction).not.toHaveBeenCalled();
  });
});
