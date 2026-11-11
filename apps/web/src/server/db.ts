import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "./env";
import type { VerificationResult } from "./nearai/verify-flow";
import { migrateAutomation } from "@tradewind/core/automation-store";
import type { InvoiceTx, TxKind } from "@/lib/receipt-txs";
export interface Draft { draft_id: string; exporter: string; doc_hash: string; text: string; shipping_text: string; extracted_json: string; created_at: number; expires_at: number }
export function migrate(db: DatabaseSync) {
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS accounts (near_account TEXT PRIMARY KEY, role_hint TEXT, display_name TEXT, country TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS drafts (draft_id TEXT PRIMARY KEY, exporter TEXT NOT NULL, doc_hash TEXT NOT NULL, text TEXT NOT NULL, shipping_text TEXT NOT NULL, extracted_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS verifications (invoice_id TEXT PRIMARY KEY, model_id TEXT NOT NULL, chat_id TEXT NOT NULL, request_hash TEXT NOT NULL, response_hash TEXT NOT NULL, signature TEXT NOT NULL, signing_address TEXT NOT NULL, signing_algo TEXT NOT NULL, signature_kind TEXT NOT NULL, attestation_nonce TEXT NOT NULL, verdict_json TEXT NOT NULL, verified_ok INTEGER NOT NULL, tx_hash TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, action TEXT NOT NULL, invoice_id TEXT, detail TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tx_log (tx_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, invoice_id TEXT, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS tx_log_invoice ON tx_log(invoice_id);`);
  const columns = new Set(db.prepare("PRAGMA table_info(tx_log)").all().map(row => row.name));
  if (!columns.has("method")) db.exec("ALTER TABLE tx_log ADD COLUMN method TEXT");
  if (!columns.has("kind")) db.exec("ALTER TABLE tx_log ADD COLUMN kind TEXT CHECK(kind IN ('create','verify','accept','advance','repay','claim','other'))");
  db.exec(`CREATE TABLE IF NOT EXISTS payment_intents (
    pid TEXT PRIMARY KEY, payment_ref TEXT NOT NULL UNIQUE, network TEXT NOT NULL,
    invoice_id TEXT NOT NULL, origin_asset TEXT NOT NULL, amount_out_e6 TEXT NOT NULL,
    amount_in TEXT NOT NULL, deposit_address TEXT NOT NULL, deposit_memo TEXT,
    refund_to TEXT NOT NULL, deadline TEXT NOT NULL, path TEXT NOT NULL CHECK(path IN ('A','B','C')),
    oneclick_status TEXT NOT NULL, origin_tx TEXT, near_tx TEXT, settled_tx TEXT,
    quote_json TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS payment_intents_invoice ON payment_intents(network, invoice_id);`);
}
export function repository(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path); migrate(db); migrateTelegram(db);
  return {
    db,
    getAccount(account: string) { return db.prepare("SELECT near_account, display_name, country FROM accounts WHERE near_account = ?").get(account); },
    putTx(hash: string, account: string, invoice: string | null, method?: string | null, kind?: TxKind | null) { db.prepare("INSERT INTO tx_log (tx_hash, account_id, invoice_id, created_at, method, kind) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(tx_hash) DO UPDATE SET invoice_id=COALESCE(excluded.invoice_id, tx_log.invoice_id), method=COALESCE(excluded.method, tx_log.method), kind=COALESCE(excluded.kind, tx_log.kind)").run(hash, account, invoice, Date.now(), method ?? null, kind ?? null); },
    txsForInvoice(id: string): InvoiceTx[] { return db.prepare("SELECT tx_hash, account_id, invoice_id, created_at, method, kind FROM tx_log WHERE invoice_id=? ORDER BY created_at, rowid").all(id) as unknown as InvoiceTx[]; },
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

// Additive migration; existing verification/account schema stays untouched.
export function migrateTelegram(db: DatabaseSync) { migrateAutomation(db); }
