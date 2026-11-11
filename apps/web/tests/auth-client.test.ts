// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { Buffer } from "buffer";
import { signIn } from "../src/lib/auth-client";

afterEach(() => vi.unstubAllGlobals());
it("passes a browser Buffer to wallet-selector and submits only the signed identity and challenge", async () => {
  const nonce = Buffer.alloc(32, 3).toString("base64");
  const signed = { accountId: "owner.testnet", publicKey: "ed25519:test", signature: "test" };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ nonce, message: "Sign in to Tradewind", recipient: "tradewind.app" }))
    .mockResolvedValueOnce(Response.json({ accountId: signed.accountId }));
  vi.stubGlobal("fetch", fetchMock);
  const wallet = { signMessage: vi.fn(async (payload: { nonce: Buffer }) => {
    expect(Buffer.isBuffer(payload.nonce)).toBe(true);
    expect(payload.nonce.toString("base64")).toBe(nonce);
    return signed;
  }) };
  expect(await signIn(wallet)).toEqual({ accountId: signed.accountId });
  expect(wallet.signMessage).toHaveBeenCalledWith({ message: "Sign in to Tradewind", recipient: "tradewind.app", nonce: Buffer.from(nonce, "base64") });
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ ...signed, nonce });
});
it("does not submit verification when wallet signing is cancelled", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ nonce: Buffer.alloc(32).toString("base64"), message: "Sign in to Tradewind", recipient: "tradewind.app" }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(signIn({ signMessage: async () => undefined })).rejects.toThrow("cancelled");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
