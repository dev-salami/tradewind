import { afterEach, expect, it, vi } from "vitest";
import { block, chunk, txStatus, poolAtBlock } from "../src/rpc";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("uses only read methods with exact block/chunk/transaction parameters", async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ result: {} })));
  vi.stubGlobal("fetch", fetcher);
  await block("http://localhost:3030", "final"); await block("http://localhost:3030", 42);
  await chunk("http://localhost:3030", "chunk-hash"); await txStatus("http://localhost:3030", "tx-hash", "sender.testnet");
  expect(fetcher.mock.calls.map(([, init]) => { const body = JSON.parse(init.body); return [body.method, body.params]; })).toEqual([
    ["block", { finality: "final" }], ["block", { block_id: 42 }], ["chunk", { chunk_id: "chunk-hash" }],
    ["EXPERIMENTAL_tx_status", { tx_hash: "tx-hash", sender_account_id: "sender.testnet", wait_until: "FINAL" }],
  ]);
});
it("backs off on 429 and respects the endpoint cooldown", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "2" } })).mockResolvedValue(new Response('{"result":{"ok":true}}'));
  vi.stubGlobal("fetch", fetcher);
  const pending = block("http://localhost:3031", "final");
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(pending).resolves.toEqual({ ok: true });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("bounds transport retries and fails closed on RPC errors", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetcher);
  const failure = expect(block("http://localhost:3032", 42)).rejects.toThrow("offline");
  await vi.runAllTimersAsync(); await failure;
  expect(fetcher).toHaveBeenCalledTimes(4);
  fetcher.mockReset().mockResolvedValue(new Response('{"error":{"cause":{"name":"UNKNOWN_BLOCK"}}}'));
  await expect(block("http://localhost:3032", 42)).rejects.toThrow("UNKNOWN_BLOCK");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("pins pool views to historical heights, never to finality", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: { result: [...new TextEncoder().encode('{"share_price_e6":"1000123"}')] } })));
  vi.stubGlobal("fetch", fetcher);
  expect(await poolAtBlock("http://localhost:3030", "core.testnet", 45)).toEqual({ share_price_e6: "1000123" });
  expect(JSON.parse(fetcher.mock.calls[0][1].body).params).toEqual({ request_type: "call_function", block_id: 45, account_id: "core.testnet", method_name: "get_pool", args_base64: "e30=" });
});
it("guards JSON-RPC rate limits and retries transient RPC timeouts", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn()
    .mockImplementationOnce(async () => new Response('{"error":{"message":"rate limit exceeded"}}'))
    .mockImplementationOnce(async () => new Response('{"error":{"cause":{"name":"TIMEOUT_ERROR"}}}'))
    .mockImplementation(async () => new Response('{"result":{"ok":true}}'));
  vi.stubGlobal("fetch", fetcher);
  const result = block("http://localhost:3033", "final");
  await vi.runAllTimersAsync();
  await expect(result).resolves.toEqual({ ok: true });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
