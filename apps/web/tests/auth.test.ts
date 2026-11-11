// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { openAutomationStore, type AutomationStore } from "@tradewind/core/automation-store";
import { store } from "../src/server/db";
import { SIGN_IN_MESSAGE, serializeNep413, verifyNep413 } from "../src/server/auth/nep413";
import { nonceStore, NONCE_TTL_MS } from "../src/server/auth/nonces";
import { assertSameOrigin, createSessionToken, getSession, requireSession, sessionCookie, SESSION_SECONDS } from "../src/server/auth/session";
import { POST as noncePost } from "../src/app/api/auth/nonce/route";
import { POST as verifyPost } from "../src/app/api/auth/verify/route";
import { POST as logoutPost } from "../src/app/api/auth/logout/route";
import { GET as meGet } from "../src/app/api/auth/me/route";
import { POST as linkPost, DELETE as linkDelete } from "../src/app/api/telegram/link/route";

vi.mock("../src/server/db", () => ({ store: vi.fn() }));
const origin = "https://tradewind.test";
const privateKey = new Uint8Array(32).fill(7);
const publicKey = `ed25519:${base58.encode(ed25519.getPublicKey(privateKey))}`;
let database: AutomationStore;
beforeEach(() => {
  vi.stubEnv("PUBLIC_BASE_URL", origin);
  vi.stubEnv("SESSION_SECRET", "test-only-session-key-with-at-least-32-bytes");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("TELEGRAM_BOT_USERNAME", "tradewind_test_bot");
  database = openAutomationStore(":memory:");
  vi.mocked(store).mockReturnValue({ db: database.db } as ReturnType<typeof store>);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ result: { permission: "FullAccess" } })));
});
afterEach(() => { database.db.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function request(path = "/api/auth/verify", body?: unknown, cookie?: string, method = "POST") {
  return new Request(`${origin}${path}`, { method, headers: { origin, ...(cookie ? { cookie } : {}), "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function signed(nonce: string, recipient = "tradewind.test") {
  const payload = { message: SIGN_IN_MESSAGE, nonce: Buffer.from(nonce, "base64"), recipient };
  const signature = Buffer.from(ed25519.sign(createHash("sha256").update(serializeNep413(payload)).digest(), privateKey)).toString("base64");
  return { ...payload, signature, accountId: "owner.testnet", publicKey };
}
const cookieFor = (account = "owner.testnet") => `tw_session=${createSessionToken(account)}`;

describe("NEP-413", () => {
  it("matches an explicit Borsh serialization vector, including optional callback", () => {
    const payload = { message: "hi", nonce: Uint8Array.from({ length: 32 }, (_, n) => n), recipient: "app" };
    const prefix = "9d010080" + "020000006869" + "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" + "03000000617070";
    expect(serializeNep413(payload).toString("hex")).toBe(prefix + "00");
    expect(serializeNep413({ ...payload, callbackUrl: "x" }).toString("hex")).toBe(prefix + "010100000078");
    expect(() => serializeNep413({ ...payload, nonce: new Uint8Array(31) })).toThrow();
  });
  it("verifies a locally generated signature and final full-access RPC ownership", async () => {
    const input = signed(Buffer.alloc(32, 9).toString("base64"));
    await expect(verifyNep413(input)).resolves.toBeUndefined();
    const call = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(call[1]!.body as string)).toMatchObject({ method: "query", params: { request_type: "view_access_key", finality: "final", account_id: input.accountId, public_key: input.publicKey } });
  });
  it("rejects wrong recipients and tampered signatures before RPC", async () => {
    const input = signed(Buffer.alloc(32).toString("base64"));
    await expect(verifyNep413({ ...input, recipient: "other.test" })).rejects.toThrow();
    await expect(verifyNep413({ ...input, signature: Buffer.alloc(64).toString("base64") })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ result: { permission: { FunctionCall: { receiver_id: "contract.testnet", method_names: [] } } } }, { error: { code: -32000 } }, {}])("fails closed for function-call, missing, or unknown keys", async result => {
    vi.mocked(fetch).mockResolvedValue(Response.json(result));
    await expect(verifyNep413(signed(Buffer.alloc(32).toString("base64")))).rejects.toThrow("Full-access key required");
  });
});

describe("nonces and auth endpoints", () => {
  it("expires at five minutes and consumes only once", () => {
    const nonces = nonceStore(database.db), value = nonces.issue(1000);
    expect(Buffer.from(value.nonce, "base64")).toHaveLength(32);
    expect(nonces.get(value.nonce, 1000 + NONCE_TTL_MS - 1)).toBeDefined();
    expect(nonces.get(value.nonce, 1000 + NONCE_TTL_MS)).toBeUndefined();
    expect(nonces.consume(value.nonce, 1000 + NONCE_TTL_MS)).toBe(false);
    const fresh = nonces.issue(2000);
    expect(nonces.consume(fresh.nonce, 2001)).toBe(true);
    expect(nonces.consume(fresh.nonce, 2001)).toBe(false);
  });
  it("issues a session, rejects replay, reads identity and clears on logout", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const challenge = await (await noncePost(request("/api/auth/nonce"))).json();
    expect(challenge).toMatchObject({ message: SIGN_IN_MESSAGE, recipient: "tradewind.test" });
    const input = signed(challenge.nonce), body = { ...input, nonce: challenge.nonce };
    const response = await verifyPost(request(undefined, body));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly; SameSite=Lax; Max-Age=43200; Secure");
    expect(await (await meGet(request("/api/auth/me", undefined, cookie.split(";")[0], "GET"))).json()).toEqual({ accountId: input.accountId });
    expect((await verifyPost(request(undefined, body))).status).toBe(401);
    const logout = await logoutPost(request("/api/auth/logout"));
    expect(logout.headers.get("set-cookie")).toContain("tw_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure");
  });
  it("allows only one session from simultaneous verification attempts", async () => {
    const challenge = nonceStore(database.db).issue();
    const body = { ...signed(challenge.nonce), nonce: challenge.nonce };
    const results = await Promise.all([verifyPost(request(undefined, body)), verifyPost(request(undefined, body))]);
    expect(results.map(r => r.status).sort()).toEqual([200, 401]);
  });
  it("rejects expired challenges without RPC and missing session configuration", async () => {
    const challenge = nonceStore(database.db).issue(Date.now() - NONCE_TTL_MS);
    expect((await verifyPost(request(undefined, { ...signed(challenge.nonce), nonce: challenge.nonce }))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => createSessionToken("owner.testnet")).toThrow("not configured");
  });
  it("uses the default recipient when the base URL is unset", () => {
    vi.stubEnv("PUBLIC_BASE_URL", "");
    expect(nonceStore(database.db).issue().recipient).toBe("tradewind.app");
  });
});

describe("sessions and CSRF", () => {
  it("rejects tampering, malformed cookies, duplicate cookies and expired sessions", () => {
    const token = createSessionToken("owner.testnet", 1_000_000);
    const withToken = (value: string) => request(undefined, undefined, `tw_session=${value}`, "GET");
    expect(getSession(withToken(token), 1_000_000)?.accountId).toBe("owner.testnet");
    expect(getSession(withToken(token), 1_000_000 + SESSION_SECONDS * 1000)).toBeNull();
    const parts = token.split(".");
    const tampered = Buffer.from(JSON.stringify({ accountId: "other.testnet", exp: 9999999999 })).toString("base64url") + "." + parts[1];
    expect(getSession(withToken(tampered))).toBeNull();
    expect(getSession(withToken("malformed"))).toBeNull();
    expect(getSession(request(undefined, undefined, `${cookieFor()}; ${cookieFor()}`, "GET"))).toBeNull();
    expect(sessionCookie("test")).not.toContain("Secure");
  });
  it("requires exact Origin for mutations, not authenticated reads", () => {
    expect(() => assertSameOrigin(request())).not.toThrow();
    for (const value of [null, "null", "https://other.test", origin + ".evil.test"]) {
      const req = request(undefined, undefined, cookieFor());
      if (value === null) req.headers.delete("origin"); else req.headers.set("origin", value);
      expect(() => requireSession(req)).toThrow("Same-origin");
    }
    expect(() => requireSession(request())).toThrow("authentication required");
    expect(requireSession(request(undefined, undefined, cookieFor())).accountId).toBe("owner.testnet");
    const read = request(undefined, undefined, cookieFor(), "GET"); read.headers.delete("origin");
    expect(requireSession(read).accountId).toBe("owner.testnet");
  });
});

describe("Telegram wallet identity", () => {
  it("marks codes verified only for the matching wallet session", async () => {
    // telegramStore returns a fresh adapter, so inspect the persisted verified flag.
    for (const authenticated of [false, true]) {
      const response = await linkPost(request("/api/telegram/link", { account_id: "owner.testnet" }, authenticated ? cookieFor() : undefined));
      expect(response.status).toBe(200);
      const body = await response.json(); expect(body.verified).toBe(authenticated);
      const rows = database.db.prepare("SELECT verified FROM telegram_link_codes").all();
      expect(rows.some(row => row.verified === Number(authenticated))).toBe(true);
    }
    vi.stubEnv("NODE_ENV", "production");
    expect((await linkPost(request("/api/telegram/link", { account_id: "owner.testnet" }))).status).toBe(401);
    expect((await linkPost(request("/api/telegram/link", { account_id: "other.testnet" }, cookieFor()))).status).toBe(401);
    expect((await linkPost(request("/api/telegram/link", { account_id: "owner.testnet" }, cookieFor()))).status).toBe(200);
  });
  it("requires matching session and same origin to unlink in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await linkDelete(request("/api/telegram/link", { account_id: "owner.testnet" }))).status).toBe(401);
    expect((await linkDelete(request("/api/telegram/link", { account_id: "other.testnet" }, cookieFor()))).status).toBe(401);
    const cross = request("/api/telegram/link", { account_id: "owner.testnet" }, cookieFor()); cross.headers.set("origin", "https://other.test");
    expect((await linkDelete(cross)).status).toBe(401);
    expect((await linkDelete(request("/api/telegram/link", { account_id: "owner.testnet" }, cookieFor()))).status).toBe(200);
  });
});
