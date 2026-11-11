import "server-only";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { env } from "../env";

export const SIGN_IN_MESSAGE = "Sign in to Tradewind";
export const validAccountId = (value: unknown): value is string => typeof value === "string" && value.length >= 2 && value.length <= 64 && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value);
export function signInRecipient() { return process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL).host : "tradewind.app"; }
export interface Nep413Payload { message: string; nonce: Uint8Array; recipient: string; callbackUrl?: string }
function borshString(value: string) {
  const bytes = Buffer.from(value, "utf8"), length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}
// NEP-413: u32 tag, string message, [u8;32] nonce, string recipient,
// Option<string> callbackUrl. The nonce has no vector-length prefix.
export function serializeNep413(payload: Nep413Payload): Buffer {
  if (payload.nonce.length !== 32) throw new Error("Invalid nonce length");
  const tag = Buffer.alloc(4); tag.writeUInt32LE(2 ** 31 + 413);
  return Buffer.concat([tag, borshString(payload.message), Buffer.from(payload.nonce), borshString(payload.recipient),
    payload.callbackUrl === undefined ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), borshString(payload.callbackUrl)])]);
}
export function decodeBase64(value: string, size: number): Buffer {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== size || bytes.toString("base64") !== value) throw new Error("Invalid base64 encoding");
  return bytes;
}
export async function verifyNep413(input: Nep413Payload & { accountId: string; publicKey: string; signature: string }, rpcFetch: typeof fetch = fetch): Promise<void> {
  if (!validAccountId(input.accountId) || input.recipient !== signInRecipient() || input.message !== SIGN_IN_MESSAGE || input.callbackUrl !== undefined) throw new Error("Invalid sign-in payload");
  if (!input.publicKey.startsWith("ed25519:")) throw new Error("Unsupported public key");
  const key = base58.decode(input.publicKey.slice(8));
  const signature = decodeBase64(input.signature, 64);
  const digest = createHash("sha256").update(serializeNep413(input)).digest();
  if (key.length !== 32 || !ed25519.verify(signature, digest, key, { zip215: false })) throw new Error("Invalid signature");
  const response = await rpcFetch(env().NEAR_RPC_URL, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ jsonrpc: "2.0", id: "auth", method: "query", params: { request_type: "view_access_key", finality: "final", account_id: input.accountId, public_key: input.publicKey } }),
  });
  if (!response.ok) throw new Error("Access-key lookup failed");
  const result = await response.json();
  if (result.error || result.result?.permission !== "FullAccess") throw new Error("Full-access key required");
}
