// Shared with the worker. Never import this module into client code.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface GuidedSession { session_id: string; buyer_account: string; encrypted_key: string; created_at: number; last_invoice_id: string | null; invoice_count: number; ready: number }
function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || Buffer.byteLength(value) < 32) throw new Error("Guided session service not configured");
  return value;
}
const mac = (id: string) => createHmac("sha256", secret()).update(`tw_guided:${id}`).digest("base64url");
export function signGuidedSession(id: string) { return `${id}.${mac(id)}`; }
export function verifyGuidedSession(token: string): string | null {
  const [id, signature, extra] = token.split(".");
  if (!id || !/^[a-f0-9]{32}$/.test(id) || !signature || extra !== undefined) return null;
  try {
    const actual = Buffer.from(signature), expected = Buffer.from(mac(id));
    return actual.length === expected.length && timingSafeEqual(actual, expected) ? id : null;
  } catch { return null; }
}
const encryptionKey = () => createHash("sha256").update(`tradewind:guided:key:${secret()}`).digest();
export function encryptGuidedKey(key: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}
export function decryptGuidedKey(value: string) {
  const bytes = Buffer.from(value, "base64url"), cipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8");
}
export function migrateGuided(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS guided_sessions (
    session_id TEXT PRIMARY KEY, buyer_account TEXT NOT NULL UNIQUE, encrypted_key TEXT NOT NULL,
    created_at INTEGER NOT NULL, last_invoice_id TEXT, invoice_count INTEGER NOT NULL DEFAULT 0, ready INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS guided_invoices (invoice_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, created_at INTEGER NOT NULL);`);
}
export function guidedSession(db: DatabaseSync, id: string) {
  return db.prepare("SELECT * FROM guided_sessions WHERE session_id=?").get(id) as unknown as GuidedSession | undefined;
}
export function nextGuidedNumber(db: DatabaseSync, id: string) {
  const row = db.prepare("UPDATE guided_sessions SET invoice_count=invoice_count+1 WHERE session_id=? RETURNING invoice_count").get(id);
  if (!row) throw new Error("Guided session missing");
  return `G-${id.slice(0, 8)}-${row.invoice_count}`;
}
