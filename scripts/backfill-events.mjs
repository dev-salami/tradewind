// Read-only entry point: no wallet, account keys, transactions, or signing imports.
import { register } from "tsx/esm/api";
register();
const { indexChain } = await import("../apps/worker/src/chain-indexer.ts");
const { openAutomationStore } = await import("../packages/core/src/automation-store.ts");
const args = process.argv.slice(2);
const value = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const rpcUrl = value("--rpc") || process.env.NEAR_RPC_URL || "http://127.0.0.1:3030";
const contractId = value("--contract") || process.env.CORE_CONTRACT_ID;
if (!contractId) throw new Error("Usage: node scripts/backfill-events.mjs --rpc URL --contract ID --start-height DEPLOY_BLOCK [--db PATH] [--max-blocks 200] [--allow-mainnet-read]");
const start = value("--start-height") ?? process.env.INDEXER_START_HEIGHT;
const seeds = JSON.parse(value("--known-txs") || "[]");
const { assertReadEndpoint } = await import("../apps/worker/src/chain-indexer.ts");
const allowMainnetRead = args.includes("--allow-mainnet-read");
assertReadEndpoint(rpcUrl, allowMainnetRead);
const store = openAutomationStore(value("--db") || process.env.DATABASE_PATH || "/tmp/opencode/chain-events.db");
try {
  console.log(JSON.stringify(await indexChain(store.db, { rpcUrl, contractId, poolContractId: process.env.POOL_CONTRACT_ID, startHeight: start === undefined ? undefined : Number(start), maxBlocks: Number(value("--max-blocks") || process.env.INDEXER_MAX_BLOCKS || 200), allowMainnetRead, knownTransactions: seeds })));
} finally { store.db.close(); }
