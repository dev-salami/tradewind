import "server-only";
import { store } from "../db";
import { ApiError, jsonError } from "../errors";
import { decodeBase64, verifyNep413 } from "./nep413";
import { nonceStore } from "./nonces";
import { assertSameOrigin, createSessionToken, getSession, sessionCookie } from "./session";

const json = (body: unknown, init: ResponseInit = {}) => Response.json(body, { ...init, headers: { ...init.headers, "Cache-Control": "no-store" } });
export async function noncePost(request: Request) {
  try { assertSameOrigin(request); return json(nonceStore(store().db).issue()); }
  catch (error) { return jsonError(error); }
}
export async function verifyPost(request: Request) {
  try {
    assertSameOrigin(request);
    let body;
    try { body = await request.json(); } catch { throw new ApiError("Invalid JSON"); }
    if (!body || !["accountId", "publicKey", "signature", "nonce"].every(key => typeof body[key] === "string" && body[key].length <= 256)) throw new ApiError("Invalid sign-in request");
    const nonces = nonceStore(store().db), challenge = nonces.get(body.nonce);
    if (!challenge) throw new ApiError("Invalid or expired nonce", 401);
    try {
      await verifyNep413({ accountId: body.accountId, publicKey: body.publicKey, signature: body.signature, nonce: decodeBase64(body.nonce, 32), message: challenge.message, recipient: challenge.recipient });
    } catch { throw new ApiError("Wallet verification failed", 401); }
    const token = createSessionToken(body.accountId);
    if (!nonces.consume(body.nonce)) throw new ApiError("Invalid or expired nonce", 401);
    return json({ accountId: body.accountId }, { headers: { "Set-Cookie": sessionCookie(token) } });
  } catch (error) { return jsonError(error); }
}
export async function logoutPost(request: Request) {
  try { assertSameOrigin(request); return json({ ok: true }, { headers: { "Set-Cookie": sessionCookie("", true) } }); }
  catch (error) { return jsonError(error); }
}
export async function meGet(request: Request) {
  const session = getSession(request);
  return json({ accountId: session?.accountId ?? null });
}
