import "server-only";
import { randomBytes } from "node:crypto";
import { KeyPair, utils } from "near-api-js";
import { store } from "../db";
import { ApiError } from "../errors";
import { tokenBucket } from "../rate-limit";
import { guidedConfig } from "./config";
import { withAccountLock, withGuidedSigner } from "./signer";
import { encryptGuidedKey, guidedSession, signGuidedSession, verifyGuidedSession } from "./session-store";

const perIp = tokenBucket(5, 3_600_000), global = tokenBucket(200, 86_400_000);
export function sessionId(request: Request) {
  const cookies = (request.headers.get("cookie") || "").split(";").map(c => c.trim()).filter(c => c.startsWith("tw_guided="));
  return cookies.length === 1 ? verifyGuidedSession(cookies[0].slice(10)) : null;
}
export function guidedCookie(id: string) {
  return `tw_guided=${signGuidedSession(id)}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
export async function provisionSession(id: string, ip: string) {
  const e = guidedConfig();
  return withAccountLock(`session:${id}`, async () => {
    const db = store().db;
    let session = guidedSession(db, id);
    if (!session) {
      if (!perIp(ip) || !global("all")) throw new ApiError("Too many demo sessions; please try again later (5/hour per IP, 200/day globally)", 429);
      const buyer = `g${randomBytes(4).toString("hex")}.${e.buyer}`;
      if (buyer.length > 64) throw new ApiError("Guided buyer root account is too long", 503);
      const key = KeyPair.fromRandom("ed25519");
      // Persist before funding: interrupted provisioning never loses the only key.
      db.prepare("INSERT INTO guided_sessions (session_id,buyer_account,encrypted_key,created_at) VALUES (?,?,?,?)").run(id, buyer, encryptGuidedKey(key.toString()), Date.now());
      session = guidedSession(db, id)!;
    }
    if (!session.ready) {
      const saved = session;
      const { decryptGuidedKey } = await import("./session-store");
      const key = KeyPair.fromString(decryptGuidedKey(saved.encrypted_key) as `ed25519:${string}`);
      const amount = utils.format.parseNearAmount(process.env.GUIDED_BUYER_FUND_NEAR || "0.5");
      if (!amount || BigInt(amount) <= 0n) throw new ApiError("Invalid guided buyer funding", 503);
      await withGuidedSigner("buyer", async root => {
        try { await root.createAccount(saved.buyer_account, key.getPublicKey(), BigInt(amount)); }
        catch (error) {
          // Only an existing account carrying our generated key is a safe retry.
          const access = await root.connection.provider.query({ request_type: "view_access_key", finality: "final", account_id: saved.buyer_account, public_key: key.getPublicKey().toString() }).catch(() => null);
          if (!access) throw error;
        }
        await root.functionCall({ contractId: e.USDC_CONTRACT_ID, methodName: "storage_deposit", args: { account_id: saved.buyer_account, registration_only: true }, gas: 30_000_000_000_000n, attachedDeposit: 1_250_000_000_000_000_000_000n });
      });
      db.prepare("UPDATE guided_sessions SET ready=1 WHERE session_id=?").run(id);
    }
    return guidedSession(db, id)!;
  });
}
export const newSessionId = () => randomBytes(16).toString("hex");
