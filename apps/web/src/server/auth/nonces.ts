import "server-only";
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { SIGN_IN_MESSAGE, signInRecipient } from "./nep413";

export const NONCE_TTL_MS = 5 * 60 * 1000;
export interface AuthNonce { nonce: string; message: string; recipient: string; expires_at: number }
export function nonceStore(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS auth_nonces (nonce TEXT PRIMARY KEY, message TEXT NOT NULL, recipient TEXT NOT NULL, expires_at INTEGER NOT NULL)");
  return {
    issue(now = Date.now()) {
      db.prepare("DELETE FROM auth_nonces WHERE expires_at <= ?").run(now);
      const value = { nonce: randomBytes(32).toString("base64"), message: SIGN_IN_MESSAGE, recipient: signInRecipient() };
      db.prepare("INSERT INTO auth_nonces VALUES (?, ?, ?, ?)").run(value.nonce, value.message, value.recipient, now + NONCE_TTL_MS);
      return value;
    },
    get(nonce: string, now = Date.now()) {
      return db.prepare("SELECT * FROM auth_nonces WHERE nonce = ? AND expires_at > ?").get(nonce, now) as unknown as AuthNonce | undefined;
    },
    // Atomic conditional deletion prevents concurrent verification from issuing two sessions.
    consume(nonce: string, now = Date.now()) {
      return db.prepare("DELETE FROM auth_nonces WHERE nonce = ? AND expires_at > ?").run(nonce, now).changes === 1;
    },
  };
}
