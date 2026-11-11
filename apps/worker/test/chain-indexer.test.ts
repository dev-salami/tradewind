import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { indexChain, migrateChainIndexer, assertReadEndpoint, seedTransactions, type ChainIndexerOptions } from "../src/chain-indexer";
import { RpcReadError, type RpcBlock, type RpcOutcome, type Pool } from "@tradewind/core";
const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const database = () => { const db = new DatabaseSync(":memory:"); databases.push(db); return db; };
const options: ChainIndexerOptions = { rpcUrl: "http://localhost:3030", contractId: "core.testnet", startHeight: 10, maxBlocks: 2 };
const log = (event: string, data = { invoice_id: "TW-0042" }) => `EVENT_JSON:${JSON.stringify({ standard: "tradewind", version: "1.0.0", event, data: [data] })}`;
function mockReads() {
  const makeBlock = (height: number): RpcBlock => ({ header: { height, prev_height: height - 1, hash: `b${height}`, timestamp_nanosec: `${height}000000000` }, chunks: [{ chunk_hash: `c${height}`, height_included: height }] });
  const outcome = (id: string, executor_id: string, logs: string[], height = 11): RpcOutcome => ({ id, block_hash: `b${height}`, outcome: { executor_id, logs, status: { SuccessValue: "" } } });
  const reads = {
    block: vi.fn(async (_url: string, at: Parameters<typeof import("@tradewind/core").block>[1]) => makeBlock(at === "final" ? 12 : typeof at === "object" ? Number(at.block_id.slice(1)) : Number(at))),
    chunk: vi.fn(async (_url: string, hash: string) => ({ transactions: hash === "c10" ? [{ hash: "tx1", signer_id: "lp.testnet", receiver_id: "usdc.testnet" }] : [], receipts: [{ receipt_id: "r1", receiver_id: "core.testnet" }] })),
    txStatus: vi.fn(async () => ({ final_execution_status: "FINAL", transaction: { hash: "tx1", signer_id: "lp.testnet" }, transaction_outcome: outcome("tx1", "usdc.testnet", []), receipts_outcome: [outcome("r1", "core.testnet", [log("pool_deposit"), log("invoice_created")]), outcome("r2", "untrusted.testnet", [log("invoice_created")])] })),
    poolAtBlock: vi.fn(async () => ({ idle: "1000000", outstanding_principal: "0", written_off: "0", total_shares: "1000000", share_price_e6: "1000000" }) as Pool),
  };
  return { reads, makeBlock, outcome };
}
describe("read-only resumable chain scanner", () => {
  it("follows FT receipts, saves real outcome heights, bounds ticks, and resumes idempotently", async () => {
    const db = database(), { reads } = mockReads();
    expect(await indexChain(db, options, reads)).toMatchObject({ blocks: 2, events: 2, snapshots: 1, nextHeight: 12 });
    expect(db.prepare("SELECT block_height, tx_hash, receipt_id, idx, invoice_id FROM chain_events ORDER BY idx").all()).toEqual([
      { block_height: 11, tx_hash: "tx1", receipt_id: "r1", idx: 0, invoice_id: "TW-0042" },
      { block_height: 11, tx_hash: "tx1", receipt_id: "r1", idx: 1, invoice_id: "TW-0042" },
    ]);
    expect(reads.poolAtBlock).toHaveBeenCalledWith(options.rpcUrl, options.contractId, 11);
    expect(db.prepare("SELECT block, ts FROM pool_snapshots").get()).toEqual({ block: 11, ts: "11000000000" });
    expect(await indexChain(db, { ...options, startHeight: undefined }, reads)).toMatchObject({ blocks: 1, events: 0, nextHeight: 13 });
    db.exec("UPDATE chain_cursor SET next_height=10");
    expect(await indexChain(db, options, reads)).toMatchObject({ events: 0, snapshots: 0 });
    expect(reads.txStatus).toHaveBeenCalledTimes(1);
  });
  it("does not advance past a failed historical view and retries the same block", async () => {
    const db = database(), { reads } = mockReads();
    reads.poolAtBlock.mockRejectedValueOnce(new Error("archival state unavailable"));
    await expect(indexChain(db, options, reads)).rejects.toThrow("archival");
    expect(db.prepare("SELECT next_height FROM chain_cursor").get()?.next_height).toBe(10);
    expect(db.prepare("SELECT COUNT(*) AS n FROM chain_events").get()?.n).toBe(0);
    expect(await indexChain(db, options, reads)).toMatchObject({ events: 2, nextHeight: 12 });
  });
  it("recovers receipts and history into a fresh DB from known tx seeds", async () => {
    const db = database(), { reads } = mockReads(); reads.chunk.mockResolvedValue({ transactions: [], receipts: [] });
    const seeded = { ...options, knownTransactions: [{ hash: "tx1", sender: "lp.testnet" }] };
    expect(await indexChain(db, seeded, reads)).toMatchObject({ events: 2, snapshots: 1, seedFailures: 0 });
    expect(await indexChain(db, seeded, reads)).toMatchObject({ events: 0 });
    expect(reads.txStatus).toHaveBeenCalledTimes(1);
  });
  it("seeds optional legacy tables and tolerates absent tables", () => {
    const db = database(); migrateChainIndexer(db);
    expect(seedTransactions(db, [], "core.testnet")).toEqual([]);
    db.exec("CREATE TABLE automation_receipts (tx_hash TEXT); INSERT INTO automation_receipts VALUES ('tx1'); CREATE TABLE tx_log (tx_hash TEXT, account_id TEXT); INSERT INTO tx_log VALUES ('tx2', 'lp.testnet')");
    expect(seedTransactions(db, [], "core.testnet")).toEqual([{ hash: "tx1", sender: "core.testnet" }, { hash: "tx2", sender: "lp.testnet" }]);
  });
  it("ignores reverted receipt logs and stops before outcomes newer than the final head", async () => {
    const db = database(), { reads, outcome } = mockReads();
    const failed = outcome("failed", "core.testnet", [log("pool_deposit")]); failed.outcome.status = { Failure: {} };
    reads.txStatus.mockResolvedValueOnce({ final_execution_status: "FINAL", transaction: { hash: "tx1", signer_id: "lp.testnet" }, transaction_outcome: failed, receipts_outcome: [failed] });
    expect(await indexChain(db, options, reads)).toMatchObject({ events: 0 });
    const fresh = database();
    reads.txStatus.mockResolvedValueOnce({ final_execution_status: "FINAL", transaction: { hash: "tx1", signer_id: "lp.testnet" }, transaction_outcome: outcome("tx1", "core.testnet", [log("pool_deposit")], 13), receipts_outcome: [] });
    await expect(indexChain(fresh, options, reads)).rejects.toThrow("newer");
    expect(fresh.prepare("SELECT next_height FROM chain_cursor").get()?.next_height).toBe(10);
  });
  it("distinguishes a proven skipped height from missing archival history", async () => {
    const db = database(), { reads, makeBlock } = mockReads();
    reads.chunk.mockResolvedValue({ transactions: [], receipts: [] });
    reads.block.mockImplementation(async (_url, at) => {
      if (at === 11) throw new RpcReadError({ cause: { name: "UNKNOWN_BLOCK" } });
      const result = makeBlock(at === "final" ? 12 : Number(at));
      if (result.header.height === 12) result.header.prev_height = 10;
      return result;
    });
    expect(await indexChain(db, { ...options, maxBlocks: 3 }, reads)).toMatchObject({ blocks: 2, nextHeight: 13 });
    const fresh = database();
    reads.block.mockImplementation(async (_url, at) => { if (at === 11) throw new RpcReadError({ cause: { name: "UNKNOWN_BLOCK" } }); return makeBlock(at === "final" ? 12 : Number(at)); });
    await expect(indexChain(fresh, { ...options, maxBlocks: 3 }, reads)).rejects.toThrow("archival");
    expect(fresh.prepare("SELECT next_height FROM chain_cursor").get()?.next_height).toBe(11);
  });
  it("requires a deploy height and prevents mixed deployment databases", async () => {
    const db = database(), { reads } = mockReads();
    await expect(indexChain(db, { ...options, startHeight: undefined }, reads)).rejects.toThrow("deploy block");
    await indexChain(db, options, reads);
    await expect(indexChain(db, { ...options, contractId: "different.testnet" }, reads)).rejects.toThrow("separate database");
  });
  it("rejects mainnet by default without making network calls", () => {
    expect(() => assertReadEndpoint("https://rpc.mainnet.near.org")).toThrow("mainnet");
    expect(() => assertReadEndpoint("https://rpc.mainnet.near.org", true)).not.toThrow();
    expect(() => assertReadEndpoint("https://testnet.fastnear.com")).not.toThrow();
    expect(() => assertReadEndpoint("http://127.0.0.1:3039")).not.toThrow();
  });
});
