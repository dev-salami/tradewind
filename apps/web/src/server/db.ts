import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "./env";
import type { VerificationResult } from "./nearai/verify-flow";
export interface Draft { draft_id: string; exporter: string; doc_hash: string; text: string; shipping_text: string; extracted_json: string; created_at: number; expires_at: number }
export function migrate(db: DatabaseSync) {
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS accounts (near_account TEXT PRIMARY KEY, role_hint TEXT, display_name TEXT, country TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS drafts (draft_id TEXT PRIMARY KEY, exporter TEXT NOT NULL, doc_hash TEXT NOT NULL, text TEXT NOT NULL, shipping_text TEXT NOT NULL, extracted_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS verifications (invoice_id TEXT PRIMARY KEY, model_id TEXT NOT NULL, chat_id TEXT NOT NULL, request_hash TEXT NOT NULL, response_hash TEXT NOT NULL, signature TEXT NOT NULL, signing_address TEXT NOT NULL, signing_algo TEXT NOT NULL, signature_kind TEXT NOT NULL, attestation_nonce TEXT NOT NULL, verdict_json TEXT NOT NULL, verified_ok INTEGER NOT NULL, tx_hash TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, action TEXT NOT NULL, invoice_id TEXT, detail TEXT NOT NULL, created_at INTEGER NOT NULL);`);
}
export function repository(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path); migrate(db);
  return {
    db,
    putDraft(d: Draft) { db.prepare("DELETE FROM drafts WHERE expires_at <= ?").run(Date.now()); db.prepare("INSERT INTO drafts VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(d.draft_id, d.exporter, d.doc_hash, d.text, d.shipping_text, d.extracted_json, d.created_at, d.expires_at); },
    getDraft(id: string) { db.prepare("DELETE FROM drafts WHERE expires_at <= ?").run(Date.now()); return db.prepare("SELECT * FROM drafts WHERE draft_id = ?").get(id) as unknown as Draft | undefined; },
    deleteDraft(id: string) { db.prepare("DELETE FROM drafts WHERE draft_id = ?").run(id); },
    putVerification(id: string, v: VerificationResult, tx: string | null) { db.prepare("INSERT OR REPLACE INTO verifications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, v.model_id, v.chat_id, v.request_hash, v.response_hash, v.signature, v.signing_address, v.signing_algo, v.signature_kind, v.attestation_nonce, JSON.stringify(v), Number(v.verified_ok), tx, Date.now()); },
    getVerification(id: string): (VerificationResult & { tx_hash: string | null }) | undefined { const row = db.prepare("SELECT verdict_json, tx_hash FROM verifications WHERE invoice_id = ?").get(id); return row ? { ...JSON.parse(row.verdict_json as string), tx_hash: row.tx_hash } : undefined; },
    audit(action: string, id: string, detail: string) { db.prepare("INSERT INTO audit_log (action, invoice_id, detail, created_at) VALUES (?, ?, ?, ?)").run(action, id, detail, Date.now()); },
    putAccount(account: string, role: string, name: string, country: string) { db.prepare("INSERT INTO accounts VALUES (?, ?, ?, ?, ?) ON CONFLICT(near_account) DO UPDATE SET role_hint=excluded.role_hint, display_name=excluded.display_name, country=excluded.country").run(account, role, name, country, Date.now()); },
  };
}
let instance: ReturnType<typeof repository> | undefined;
export function store() { return instance ??= repository(env().DATABASE_PATH); }
