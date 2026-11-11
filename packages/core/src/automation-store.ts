// Node-only entry point: never re-export this module from the browser core barrel.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { TelegramCard } from "./telegram-cards";
import { retryPlan } from "./worker-decisions";
export function migrateAutomation(db: DatabaseSync) {
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS telegram_link_codes (code TEXT PRIMARY KEY, near_account TEXT NOT NULL, role TEXT NOT NULL, verified INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS telegram_links (near_account TEXT NOT NULL, tg_user_id TEXT NOT NULL, tg_chat_id TEXT NOT NULL, role TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, linked_at INTEGER NOT NULL, PRIMARY KEY(near_account, role));
    CREATE TABLE IF NOT EXISTS telegram_callbacks (token TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, action TEXT NOT NULL, terms_hash TEXT NOT NULL, amount_e6 TEXT NOT NULL, tg_user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
    CREATE TABLE IF NOT EXISTS notifications_outbox (id INTEGER PRIMARY KEY, dedupe_key TEXT UNIQUE NOT NULL, near_account TEXT NOT NULL, chat_id TEXT, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, sent_at INTEGER, created_at INTEGER NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS invoices_cache (id TEXT PRIMARY KEY, network TEXT NOT NULL, exporter TEXT NOT NULL, buyer TEXT NOT NULL, face_e6 TEXT NOT NULL, status TEXT NOT NULL, due_at TEXT, json_snapshot TEXT NOT NULL, updated_block TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS buyer_records_cache (account TEXT PRIMARY KEY, json_snapshot TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pool_snapshots (block INTEGER PRIMARY KEY, ts TEXT NOT NULL, idle TEXT NOT NULL, outstanding TEXT NOT NULL, written_off TEXT NOT NULL, total_shares TEXT NOT NULL, share_price_e6 TEXT NOT NULL, json_snapshot TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reminders (invoice_id TEXT NOT NULL, step TEXT NOT NULL, channel TEXT NOT NULL, sent_at INTEGER NOT NULL, UNIQUE(invoice_id, step));
    CREATE TABLE IF NOT EXISTS automation_receipts (invoice_id TEXT NOT NULL, tx_hash TEXT NOT NULL, detail TEXT NOT NULL, PRIMARY KEY(invoice_id, tx_hash));
    CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, action TEXT NOT NULL, invoice_id TEXT, detail TEXT NOT NULL, created_at INTEGER NOT NULL);`);
}
export interface Link { near_account: string; tg_user_id: string; tg_chat_id: string; role: string; verified: number }
export interface CallbackToken { token: string; invoice_id: string; action: "approve" | "skip"; terms_hash: string; amount_e6: string; tg_user_id: string; expires_at: number; used_at: number | null }
export interface OutboxRow { id: number; chat_id: string | null; payload: string; attempts: number }
export function automationStore(db: DatabaseSync) {
  return {
    db,
    transaction<T>(work: () => T): T { db.exec("BEGIN IMMEDIATE"); try { const result = work(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } },
    link(account: string, role = "exporter") { return db.prepare("SELECT * FROM telegram_links WHERE near_account=? AND role=?").get(account, role) as unknown as Link | undefined; },
    issueCode(account: string, role: string, verified: boolean, now = Date.now()) {
      const code = randomBytes(16).toString("hex");
      db.prepare("DELETE FROM telegram_link_codes WHERE expires_at<=? OR (near_account=? AND role=?)").run(now, account, role);
      db.prepare("INSERT INTO telegram_link_codes VALUES (?, ?, ?, ?, ?)").run(code, account, role, Number(verified), now + 600_000); return code;
    },
    consumeCode(code: string, user: string, chat: string, now = Date.now()) {
      return this.transaction(() => {
        const row = db.prepare("DELETE FROM telegram_link_codes WHERE code=? AND expires_at>? RETURNING *").get(code, now);
        if (!row) return false;
        db.prepare("INSERT OR REPLACE INTO telegram_links VALUES (?, ?, ?, ?, ?, ?)").run(row.near_account, user, chat, row.role, row.verified, now); return true;
      });
    },
    issueCallback(data: Omit<CallbackToken, "token" | "expires_at" | "used_at">, now = Date.now()) {
      const token = randomBytes(16).toString("hex");
      db.prepare("INSERT INTO telegram_callbacks VALUES (?, ?, ?, ?, ?, ?, ?, NULL)").run(token, data.invoice_id, data.action, data.terms_hash, data.amount_e6, data.tg_user_id, now + 1_800_000); return token;
    },
    callback(token: string) { return db.prepare("SELECT * FROM telegram_callbacks WHERE token=?").get(token) as unknown as CallbackToken | undefined; },
    revokeCallbacks(invoice_id: string, now = Date.now()) {
      db.prepare("UPDATE telegram_callbacks SET used_at=? WHERE invoice_id=? AND used_at IS NULL").run(now, invoice_id);
    },
    consumeCallback(token: string, user: string, now = Date.now()) {
      return db.prepare("UPDATE telegram_callbacks SET used_at=? WHERE token=? AND tg_user_id=? AND used_at IS NULL AND expires_at>? RETURNING *").get(now, token, user, now) as unknown as CallbackToken | undefined;
    },
    enqueue(account: string, kind: string, card: TelegramCard, key: string, role = "exporter", now = Date.now()) {
      const link = this.link(account, role);
      db.prepare("INSERT OR IGNORE INTO notifications_outbox (dedupe_key, near_account, chat_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(key, account, link?.tg_chat_id ?? null, kind, JSON.stringify(card), now);
    },
    audit(action: string, invoice: string, user: string, tx: string | null, result: string) { db.prepare("INSERT INTO audit_log (action, invoice_id, detail, created_at) VALUES (?, ?, ?, ?)").run(action, invoice, JSON.stringify({ tg_user_id: user, tx_hash: tx, result }), Date.now()); },
  };
}
export type AutomationStore = ReturnType<typeof automationStore>;
export function openAutomationStore(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path); db.exec("PRAGMA journal_mode=WAL"); migrateAutomation(db); return automationStore(db);
}
export async function drainOutbox(s: AutomationStore, token: string | undefined, send: (chat: string, card: TelegramCard) => Promise<unknown>, now = Date.now()) {
  const rows = s.transaction(() => {
    const rows = s.db.prepare("SELECT id, chat_id, payload, attempts FROM notifications_outbox WHERE status='pending' AND next_attempt_at<=? AND lease_until<=? ORDER BY id LIMIT 100").all(now, now) as unknown as OutboxRow[];
    for (const row of rows) s.db.prepare("UPDATE notifications_outbox SET lease_until=? WHERE id=?").run(now + 60_000, row.id);
    return rows;
  });
  for (const row of rows) {
    if (!token || !row.chat_id) { s.db.prepare("UPDATE notifications_outbox SET status=?, lease_until=0 WHERE id=?").run(!token ? "skipped_no_token" : "skipped_unlinked", row.id); continue; }
    try {
      await send(row.chat_id, JSON.parse(row.payload) as TelegramCard);
      s.db.prepare("UPDATE notifications_outbox SET status='sent', sent_at=?, attempts=attempts+1, lease_until=0 WHERE id=?").run(now, row.id);
    } catch {
      const plan = retryPlan(row.attempts + 1, now);
      s.db.prepare("UPDATE notifications_outbox SET status=?, attempts=attempts+1, next_attempt_at=?, lease_until=0 WHERE id=?").run(plan.status, plan.next_attempt_at, row.id);
    }
  }
}
