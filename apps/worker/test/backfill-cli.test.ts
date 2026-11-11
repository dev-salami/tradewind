import { expect, it } from "vitest";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const run = promisify(execFile);
const script = fileURLToPath(new URL("../../../scripts/backfill-events.mjs", import.meta.url));
it("runs the real one-shot CLI against a localhost read-only RPC and resumes", async () => {
  const methods: string[] = [];
  const makeBlock = (height: number) => ({ header: { height, hash: `b${height}`, prev_height: height - 1, timestamp_nanosec: `${height}000000000` }, chunks: [{ chunk_hash: `c${height}`, height_included: height }] });
  const server = createServer(async (request, response) => {
    let body = ""; for await (const part of request) body += part;
    const { method, params } = JSON.parse(body); methods.push(method);
    let result: unknown;
    if (method === "block") result = makeBlock(params.finality ? 12 : typeof params.block_id === "string" ? Number(params.block_id.slice(1)) : params.block_id);
    else if (method === "chunk") result = { receipts: [], transactions: params.chunk_id === "c10" ? [{ hash: "tx1", signer_id: "lp.testnet", receiver_id: "usdc.testnet" }] : [] };
    else if (method === "EXPERIMENTAL_tx_status") result = { final_execution_status: "FINAL", transaction: { hash: "tx1", signer_id: "lp.testnet" }, transaction_outcome: { id: "tx1", block_hash: "b10", outcome: { executor_id: "usdc.testnet", logs: [], status: { SuccessValue: "" } } }, receipts_outcome: [{ id: "r1", block_hash: "b11", outcome: { executor_id: "core.testnet", logs: ['EVENT_JSON:{"standard":"tradewind","version":"1.0.0","event":"pool_deposit","data":[{"amount":"1000000","shares":"1000000","account_id":"lp.testnet"}]}'], status: { SuccessValue: "" } } }] };
    else if (method === "query" && params.request_type === "call_function" && params.method_name === "get_pool" && params.block_id === 11) result = { result: [...new TextEncoder().encode(JSON.stringify({ idle: "1000000", outstanding_principal: "0", written_off: "0", total_shares: "1000000", share_price_e6: "1000000" }))] };
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(result === undefined ? { error: "Unexpected/non-read method" } : { result }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No server address");
  const directory = await mkdtemp(join(tmpdir(), "tradewind-indexer-"));
  const args = [script, "--rpc", `http://127.0.0.1:${address.port}`, "--contract", "core.testnet", "--start-height", "10", "--max-blocks", "1", "--db", join(directory, "chain.db")];
  try {
    const first = await run(process.execPath, args);
    expect(JSON.parse(first.stdout)).toMatchObject({ blocks: 1, events: 1, snapshots: 1, nextHeight: 11 });
    const second = await run(process.execPath, args);
    expect(JSON.parse(second.stdout)).toMatchObject({ blocks: 1, events: 0, snapshots: 0, nextHeight: 12 });
    expect(new Set(methods)).toEqual(new Set(["block", "chunk", "EXPERIMENTAL_tx_status", "query"]));
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(directory, { recursive: true, force: true }); }
}, 20_000);
it("refuses mainnet before attempting network access", async () => {
  await expect(run(process.execPath, [script, "--rpc", "https://rpc.mainnet.near.org", "--contract", "core.testnet", "--start-height", "10"])).rejects.toMatchObject({ stderr: expect.stringContaining("mainnet reads require --allow-mainnet-read") });
});
