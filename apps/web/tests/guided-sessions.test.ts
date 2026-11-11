// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { decryptGuidedKey, encryptGuidedKey, guidedSession, migrateGuided, nextGuidedNumber, signGuidedSession, verifyGuidedSession } from "../src/server/guided/session-store";
import { guidedCookie, provisionSession, sessionId } from "../src/server/guided/sessions";

const mocks = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined, create: vi.fn(), call: vi.fn(), keys: vi.fn() }));
vi.mock("../src/server/db", () => ({ store: () => ({ db: mocks.db! }) }));
vi.mock("near-api-js", () => ({
  KeyPair: { fromRandom: () => ({ toString: () => "ed25519:generated-test-key", getPublicKey: () => "public-test-key" }), fromString: (key: string) => ({ toString: () => key, getPublicKey: () => "public-test-key" }) },
  utils: { format: { parseNearAmount: (value: string) => value === "0.5" ? "500000000000000000000000" : "1000000000000000000000000" } },
  keyStores: { InMemoryKeyStore: class { setKey(...args: unknown[]) { mocks.keys(...args); } } },
  connect: async () => ({ connection: {} }),
  Account: class { createAccount(...args: unknown[]) { return mocks.create(...args); } functionCall(...args: unknown[]) { return mocks.call(...args); } },
}));
beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-only-secret-at-least-thirty-two-bytes");
  vi.stubEnv("NEAR_NETWORK", "sandbox"); vi.stubEnv("GUIDED_ENABLED", "1");
  vi.stubEnv("GUIDED_EXPORTER_ACCOUNT_ID", "exporter.test.near"); vi.stubEnv("GUIDED_EXPORTER_PRIVATE_KEY", "exporter-key");
  vi.stubEnv("GUIDED_BUYER_ACCOUNT_ID", "buyer.test.near"); vi.stubEnv("GUIDED_BUYER_PRIVATE_KEY", "buyer-key");
  vi.stubEnv("CORE_CONTRACT_ID", "core.test.near"); vi.stubEnv("USDC_CONTRACT_ID", "usdc.test.near");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden"); }));
  mocks.db = new DatabaseSync(":memory:"); migrateGuided(mocks.db);
  mocks.create.mockResolvedValue({}); mocks.call.mockResolvedValue({});
});
afterEach(() => { mocks.db?.close(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("signs, verifies and rejects tampered, duplicate and malformed cookies", () => {
  const id = "a".repeat(32), token = signGuidedSession(id);
  expect(verifyGuidedSession(token)).toBe(id);
  expect(verifyGuidedSession(token.replace(/^a/, "b"))).toBeNull();
  expect(verifyGuidedSession(`${token}x`)).toBeNull();
  expect(verifyGuidedSession("bad")).toBeNull();
  const request = new Request("http://localhost", { headers: { cookie: `tw_guided=${token}` } });
  expect(sessionId(request)).toBe(id);
  request.headers.append("cookie", `; tw_guided=${token}`); expect(sessionId(request)).toBeNull();
  expect(guidedCookie(id)).toContain("HttpOnly; SameSite=Lax"); expect(guidedCookie(id)).not.toContain("Max-Age");
});
it("authenticates encrypted keys and never stores plaintext", () => {
  const encrypted = encryptGuidedKey("ed25519:private-test-key");
  expect(encrypted).not.toContain("private-test-key"); expect(decryptGuidedKey(encrypted)).toBe("ed25519:private-test-key");
  const bytes = Buffer.from(encrypted, "base64url"); bytes[12] = bytes[12]! ^ 1;
  expect(() => decryptGuidedKey(bytes.toString("base64url"))).toThrow();
});
it("creates independent funded buyers, registers storage and reuses each session", async () => {
  const a = await provisionSession("1".repeat(32), "provision-a"), b = await provisionSession("2".repeat(32), "provision-b");
  expect(a.buyer_account).toMatch(/^g[0-9a-f]{8}\.buyer\.test\.near$/); expect(a.buyer_account).not.toBe(b.buyer_account);
  expect(mocks.create).toHaveBeenCalledWith(a.buyer_account, "public-test-key", 500000000000000000000000n);
  expect(mocks.call).toHaveBeenCalledWith(expect.objectContaining({ methodName: "storage_deposit", args: { account_id: a.buyer_account, registration_only: true } }));
  expect(decryptGuidedKey(a.encrypted_key)).toBe("ed25519:generated-test-key");
  await provisionSession(a.session_id, "provision-a"); expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(nextGuidedNumber(mocks.db!, a.session_id)).toBe("G-11111111-1");
  expect(nextGuidedNumber(mocks.db!, a.session_id)).toBe("G-11111111-2");
  expect(nextGuidedNumber(mocks.db!, b.session_id)).toBe("G-22222222-1");
});
it("serializes simultaneous provisioning for one session", async () => {
  const id = "3".repeat(32);
  const [a, b] = await Promise.all([provisionSession(id, "same-session"), provisionSession(id, "same-session")]);
  expect(a.buyer_account).toBe(b.buyer_account); expect(mocks.create).toHaveBeenCalledTimes(1);
});
it("caps new sessions per IP and refuses mainnet before creating any row", async () => {
  for (let n = 0; n < 5; n++) await provisionSession(n.toString(16).padStart(32, "0"), "capped-ip");
  await expect(provisionSession("f".repeat(32), "capped-ip")).rejects.toMatchObject({ status: 429 });
  expect(guidedSession(mocks.db!, "f".repeat(32))).toBeUndefined();
  vi.stubEnv("NEAR_NETWORK", "mainnet");
  await expect(provisionSession("e".repeat(32), "mainnet-ip")).rejects.toMatchObject({ status: 403 });
  expect(mocks.create).toHaveBeenCalledTimes(5);
});
it("caps global provisioning even when every request uses a different IP", async () => {
  // Advance beyond the refill window to isolate this bucket from earlier tests.
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 2 * 86_400_000);
  for (let n = 0; n < 200; n++) await provisionSession(n.toString(16).padStart(32, "0"), `global-cap-${n}`);
  await expect(provisionSession("f".repeat(32), "global-cap-overflow")).rejects.toMatchObject({ status: 429, message: expect.stringContaining("200/day") });
  expect(mocks.create).toHaveBeenCalledTimes(200);
  expect(guidedSession(mocks.db!, "f".repeat(32))).toBeUndefined();
});
