import { block, chunk, txStatus, poolAtBlock, parseEvents, RpcReadError, NETWORKS, type RpcBlock, type RpcTxStatus, type Pool } from "@tradewind/core";
import type { DatabaseSync } from "node:sqlite";

export interface ChainIndexerOptions {
  rpcUrl: string; contractId: string; poolContractId?: string;
  startHeight?: number; maxBlocks?: number; allowMainnetRead?: boolean;
  knownTransactions?: { hash: string; sender: string }[];
}
export const chainReads = { block, chunk, txStatus, poolAtBlock };
type Reads = typeof chainReads;

export function assertReadEndpoint(url: string, allowMainnetRead = false) {
  const endpoint = new URL(url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  const testnet = endpoint.hostname === "testnet.near.org" || endpoint.hostname.endsWith(".testnet.near.org") || endpoint.hostname === "testnet.fastnear.com";
  if (!local && (!testnet || endpoint.protocol !== "https:") && !allowMainnetRead) throw new Error("Indexer permits localhost/testnet only; mainnet reads require --allow-mainnet-read");
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error("Invalid RPC endpoint");
}
export function migrateChainIndexer(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS chain_cursor (id TEXT PRIMARY KEY, deploy_height INTEGER NOT NULL, next_height INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS chain_events (block_height INTEGER NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL, idx INTEGER NOT NULL, event TEXT NOT NULL, invoice_id TEXT, data_json TEXT NOT NULL, ts TEXT NOT NULL, PRIMARY KEY(receipt_id, idx));
    CREATE INDEX IF NOT EXISTS chain_events_invoice ON chain_events(invoice_id, block_height);
    CREATE TABLE IF NOT EXISTS chain_transactions (hash TEXT PRIMARY KEY, sender TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chain_snapshot_blocks (block INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS pool_snapshots (block INTEGER PRIMARY KEY, ts TEXT NOT NULL, idle TEXT NOT NULL, outstanding TEXT NOT NULL, written_off TEXT NOT NULL, total_shares TEXT NOT NULL, share_price_e6 TEXT NOT NULL, json_snapshot TEXT NOT NULL);`);
}
const tableExists = (db: DatabaseSync, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
export function seedTransactions(db: DatabaseSync, supplied: ChainIndexerOptions["knownTransactions"] = [], fallbackSender: string) {
  const seeds = new Map(supplied.map(tx => [tx.hash, tx.sender]));
  for (const table of ["automation_receipts", "tx_log"]) {
    if (!tableExists(db, table)) continue;
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
    if (!columns.includes("tx_hash")) continue;
    const sender = columns.includes("account_id") ? "account_id" : "NULL";
    for (const row of db.prepare(`SELECT tx_hash, ${sender} AS sender FROM ${table} WHERE tx_hash IS NOT NULL ORDER BY rowid DESC LIMIT 200`).all()) {
      const hash = String(row.tx_hash);
      if (!seeds.has(hash)) seeds.set(hash, row.sender ? String(row.sender) : fallbackSender);
    }
  }
  return [...seeds].map(([hash, sender]) => ({ hash, sender }));
}
const poolActivity = new Set(["pool_deposit", "pool_redeem", "pool_redeem_reverted", "advance_paid", "advance_reverted", "payment_received", "waterfall_split", "invoice_defaulted", "admin_action"]);
function atomic<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const value = work(); db.exec("COMMIT"); return value; } catch (error) { db.exec("ROLLBACK"); throw error; }
}

/** No keys, wallet, or signing dependency. Cursor commits only after all reads succeed. */
export async function indexChain(db: DatabaseSync, options: ChainIndexerOptions, reads: Reads = chainReads) {
  assertReadEndpoint(options.rpcUrl, options.allowMainnetRead);
  if (!options.contractId) throw new Error("CORE_CONTRACT_ID is required");
  const limit = options.maxBlocks ?? 200;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) throw new Error("Invalid INDEXER_MAX_BLOCKS (1..2000)");
  if (options.startHeight !== undefined && (!Number.isSafeInteger(options.startHeight) || options.startHeight < 0)) throw new Error("Invalid INDEXER_START_HEIGHT");
  migrateChainIndexer(db);
  const id = `${options.rpcUrl}|${options.contractId}|${options.poolContractId ?? options.contractId}`;
  const other = db.prepare("SELECT id FROM chain_cursor WHERE id<>?").get(id);
  if (other) throw new Error("Use a separate database per chain/deployment");
  let cursor = db.prepare("SELECT * FROM chain_cursor WHERE id=?").get(id);
  if (!cursor) {
    if (options.startHeight === undefined) throw new Error("INDEXER_START_HEIGHT must be the contract deploy block (or a recorded chain_cursor deploy_height)");
    db.prepare("INSERT INTO chain_cursor VALUES (?, ?, ?)").run(id, options.startHeight, options.startHeight);
    cursor = db.prepare("SELECT * FROM chain_cursor WHERE id=?").get(id)!;
  }
  const start = Number(cursor.next_height), deploy = Number(cursor.deploy_height);
  const head = await reads.block(options.rpcUrl, "final");
  const receivers = new Set([options.contractId, options.poolContractId ?? options.contractId]);
  const blocks = new Map<string, RpcBlock>([[head.header.hash, head]]);
  let eventCount = 0, snapshotCount = 0, scanned = 0, seedFailures = 0;

  async function ingest(hash: string, sender: string) {
    if (db.prepare("SELECT 1 FROM chain_transactions WHERE hash=?").get(hash)) return;
    const result: RpcTxStatus = await reads.txStatus(options.rpcUrl, hash, sender);
    if (result.final_execution_status !== "FINAL") throw new Error("Transaction outcomes are not final yet");
    const events: ReturnType<typeof parseEvents> = [];
    const snapshots = new Map<number, { pool: Pool; ts: string }>();
    // Receipt executor, not transaction receiver, determines which logs are trusted.
    for (const outcome of [result.transaction_outcome, ...result.receipts_outcome]) {
      if (!receivers.has(outcome.outcome.executor_id) || "Failure" in outcome.outcome.status) continue;
      if (!outcome.outcome.logs.some(log => log.startsWith("EVENT_JSON:"))) continue;
      let at = blocks.get(outcome.block_hash);
      if (!at) { at = await reads.block(options.rpcUrl, { block_id: outcome.block_hash }); blocks.set(outcome.block_hash, at); }
      if (at.header.height > head.header.height) throw new Error("Receipt newer than final scan head; retry next tick");
      if (at.header.height < deploy) continue;
      const parsed = parseEvents(outcome.outcome.logs, { tx_hash: hash, receipt_id: outcome.id, block_height: at.header.height, block_timestamp: at.header.timestamp_nanosec });
      events.push(...parsed);
      if (!snapshots.has(at.header.height) && parsed.some(event => poolActivity.has(event.event))) snapshots.set(at.header.height, { pool: await reads.poolAtBlock(options.rpcUrl, options.poolContractId ?? options.contractId, at.header.height), ts: at.header.timestamp_nanosec });
    }
    atomic(db, () => {
      for (const event of events) {
        const inserted = db.prepare("INSERT OR IGNORE INTO chain_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(event.block_height, hash, event.receipt_id, event.idx, event.event, typeof event.data.invoice_id === "string" ? event.data.invoice_id : null, JSON.stringify(event.data), event.block_timestamp);
        eventCount += Number(inserted.changes);
      }
      for (const [height, { pool, ts }] of snapshots) {
        const exists = db.prepare("SELECT 1 FROM chain_snapshot_blocks WHERE block=?").get(height);
        db.prepare("INSERT OR REPLACE INTO pool_snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(height, ts, pool.idle, pool.outstanding_principal, pool.written_off, pool.total_shares, pool.share_price_e6, JSON.stringify(pool));
        db.prepare("INSERT OR IGNORE INTO chain_snapshot_blocks VALUES (?)").run(height);
        if (!exists) snapshotCount++;
      }
      db.prepare("INSERT OR IGNORE INTO chain_transactions VALUES (?, ?)").run(hash, sender);
    });
  }
  // Missing/pruned optional seeds must not stop the authoritative block scan.
  for (const seed of seedTransactions(db, options.knownTransactions, options.contractId)) {
    try { await ingest(seed.hash, seed.sender); } catch { seedFailures++; }
  }
  let skippedHeight = false;
  let previousHeight = start - 1;
  for (let height = start; height <= head.header.height && height < start + limit; height++) {
    let at: RpcBlock;
    try { at = await reads.block(options.rpcUrl, height); }
    catch (error) {
      // NEAR can skip heights. Only the explicit absent-height error is skippable;
      // transport/rate-limit/archival failures leave the cursor untouched.
      if (error instanceof RpcReadError && JSON.stringify(error.detail).includes('"UNKNOWN_BLOCK"')) { skippedHeight = true; continue; }
      throw error;
    }
    if (skippedHeight && at.header.prev_height !== previousHeight) throw new Error("Missing historical block: use an archival RPC; cursor not advanced across gap");
    skippedHeight = false;
    blocks.set(at.header.hash, at);
    for (const shard of at.chunks) {
      if (shard.height_included !== height) continue;
      const contents = await reads.chunk(options.rpcUrl, shard.chunk_hash);
      // Scan every originating tx: FT transfers and cross-contract calls may reach
      // core through receipts even when the top-level receiver is a token account.
      // tx status contains the complete execution graph, including chunk receipts.
      for (const transaction of contents.transactions) await ingest(transaction.hash, transaction.signer_id);
    }
    db.prepare("UPDATE chain_cursor SET next_height=? WHERE id=?").run(height + 1, id);
    previousHeight = height;
    scanned++;
  }
  return { blocks: scanned, events: eventCount, snapshots: snapshotCount, seedFailures, nextHeight: Number(db.prepare("SELECT next_height FROM chain_cursor WHERE id=?").get(id)!.next_height), finalHeight: head.header.height };
}
export function indexerOptions(env: NodeJS.ProcessEnv = process.env): ChainIndexerOptions {
  return { rpcUrl: env.NEAR_RPC_URL || env.NEXT_PUBLIC_NEAR_RPC_URL || NETWORKS.testnet, contractId: env.CORE_CONTRACT_ID || env.NEXT_PUBLIC_CORE_CONTRACT_ID || "", poolContractId: env.POOL_CONTRACT_ID, startHeight: env.INDEXER_START_HEIGHT === undefined ? undefined : Number(env.INDEXER_START_HEIGHT), maxBlocks: env.INDEXER_MAX_BLOCKS === undefined ? undefined : Number(env.INDEXER_MAX_BLOCKS) };
}
