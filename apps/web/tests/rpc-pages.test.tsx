import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BuyerRecord, Config, Pool } from "@tradewind/core";
import PoolPage from "../src/app/pool/page";
import BuyerRecordPage from "../src/app/buyer/[account]/page";

// Indexed history is a separate local data source, not a contract view.
vi.mock("../src/server/telegram/history", () => ({ snapshotHistory: () => [] }));
vi.mock("../src/components/wallet-provider", () => ({ useWallet: () => ({ accountId: null, callView: vi.fn(), revision: 0 }) }));

const pool: Pool = { idle: "123456789", outstanding_principal: "76543211", written_off: "0", total_assets: "200000000", total_shares: "160000000", share_price_e6: "1250000", fees_earned: "7654321", protocol_fees_paid: "123456" };
const buyer: BuyerRecord = { accepted: 9, repaid_on_time: 7, repaid_grace: 1, repaid_late: 0, defaulted: 0, recovered: 0, repaid_volume: "314159265", open_principal: "76543211", score: 27, frozen: false, last_update: "1700000000000000000", rate_bps: 8700, buyer_limit: "500000000" };
const config: Config = { usdc: "usdc.testnet", seconds_per_day: 10, base_rate_bps: 7000, max_rate_bps: 9000, rate_step_bps: 100, pool_fee_bps_per_30d: 100, protocol_fee_bps: 50, grace_days: 7, default_after_days: 30, min_counted_face: "1000000", min_payment: "1000000", max_face: "1000000000", base_buyer_limit: "500000000", limit_from_volume_bps: 1000, max_single_advance_bps: 10000, invoice_counter_start: 1, paused: false };
const views: Record<string, unknown> = { get_pool: pool, get_config: config, get_buyer_record: buyer, invoices_by_buyer: [], list_invoices: [] };
const requests: { method: string; args: unknown }[] = [];

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DATA_SOURCE", "rpc");
  vi.stubEnv("NEXT_PUBLIC_CORE_CONTRACT_ID", "core.testnet");
  vi.stubEnv("NEXT_PUBLIC_NEAR_NETWORK", "testnet");
  vi.stubEnv("NEXT_PUBLIC_NEAR_RPC_URL", "https://rpc.invalid");
  requests.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { jsonrpc: string; id: string; method: string; params: { request_type: string; account_id: string; method_name: string; args_base64: string } };
    expect(request.jsonrpc).toBe("2.0");
    expect(request.method).toBe("query");
    expect(request.params.request_type).toBe("call_function");
    expect(request.params.account_id).toBe("core.testnet");
    const method = request.params.method_name;
    if (!(method in views)) throw new Error(`Unexpected RPC view: ${method}`);
    requests.push({ method, args: JSON.parse(Buffer.from(request.params.args_base64, "base64").toString("utf8")) });
    // NEAR returns the decoded JSON as UTF-8 byte numbers, not a base64 string.
    return Response.json({ jsonrpc: "2.0", id: request.id, result: { result: Array.from(Buffer.from(JSON.stringify(views[method]), "utf8")), logs: [], block_height: 1, block_hash: "test-block" } });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("RPC-backed server pages", () => {
  it("renders contract pool TVL, idle liquidity and share price rather than fixture values", async () => {
    const html = renderToStaticMarkup(await PoolPage());
    expect(html).toContain("$200.00");
    expect(html).toContain("$123.45");
    expect(html).toContain("1.2500");
    expect(html).toContain("On-chain pool · testnet");
    expect(html).not.toMatch(/sample preview|seeded by the team/i);
    expect(requests.map(r => r.method)).toEqual(expect.arrayContaining(["get_pool", "get_config", "list_invoices"]));
  });
  it("renders the requested buyer's on-chain score and advance rate with honest testnet copy", async () => {
    const html = renderToStaticMarkup(await BuyerRecordPage({ params: Promise.resolve({ account: "buyer.testnet" }) }));
    expect(html).toMatch(/<strong>27<\/strong>/);
    expect(html).toContain("87%");
    expect(html).toContain("$500.00");
    expect(html).toContain("Record built from on-chain invoices · testnet");
    expect(html).not.toMatch(/team test wallet|sample preview|team test invoices/i);
    expect(requests).toEqual(expect.arrayContaining([
      { method: "get_buyer_record", args: { account_id: "buyer.testnet" } },
      { method: "invoices_by_buyer", args: { account_id: "buyer.testnet" } },
    ]));
  });
});
