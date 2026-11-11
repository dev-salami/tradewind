import { afterEach, describe, expect, it, vi } from "vitest";
import { rpcData } from "../src/datasource";
import { explorerAccount, explorerTx, viewFunction } from "../src/rpc";
afterEach(() => vi.unstubAllGlobals());
const reply = (value: unknown) => ({ ok: true, json: async () => ({ result: { result: Array.from(new TextEncoder().encode(JSON.stringify(value))) } }) });
describe("fetch-only NEAR views", () => {
  it("encodes UTF-8 JSON args as base64 and decodes result bytes", async () => {
    const mock = vi.fn().mockResolvedValue(reply({ label: "交易 (sample)", amount: "10000000" }));
    vi.stubGlobal("fetch", mock);
    expect(await viewFunction("http://localhost:3030", "core.testnet", "get_invoice", { id: "é" })).toEqual({ label: "交易 (sample)", amount: "10000000" });
    const body = JSON.parse(mock.mock.calls[0][1].body);
    expect(body).toMatchObject({ jsonrpc: "2.0", method: "query", params: { request_type: "call_function", finality: "final", account_id: "core.testnet", method_name: "get_invoice" } });
    expect(body.params.args_base64).toBe("eyJpZCI6IsOpIn0=");
  });
  it("maps every view to the exact spec argument names", async () => {
    const mock = vi.fn().mockResolvedValue(reply(null)); vi.stubGlobal("fetch", mock);
    const d = rpcData({ rpcUrl: "http://localhost:3030", contractId: "core.testnet" });
    await d.getInvoice("TW-0042"); await d.listInvoices(2, 3); await d.invoicesByExporter("e"); await d.invoicesByBuyer("b");
    await d.getBuyerRecord("b"); await d.previewAdvance("TW-0042"); await d.getPool(); await d.getConfig();
    await d.previewDeposit("100"); await d.previewRedeem("50"); await d.getClaimable("e"); await d.listUnattributed(); await d.isLpAllowed("lp"); await d.nowContractDay("TW-0042");
    expect(mock.mock.calls.map(call => { const p = JSON.parse(call[1].body).params; return [p.method_name, JSON.parse(atob(p.args_base64))]; })).toEqual([
      ["get_invoice", { id: "TW-0042" }], ["list_invoices", { from: 2, limit: 3 }], ["invoices_by_exporter", { acct: "e" }], ["invoices_by_buyer", { acct: "b" }],
      ["get_buyer_record", { acct: "b" }], ["preview_advance", { id: "TW-0042" }], ["get_pool", {}], ["get_config", {}], ["preview_deposit", { a: "100" }], ["preview_redeem", { s: "50" }],
      ["get_claimable", { acct: "e" }], ["list_unattributed", {}], ["is_lp_allowed", { acct: "lp" }], ["now_contract_day", { id: "TW-0042" }],
    ]);
    expect(await d.poolHistory()).toEqual([]); expect(mock).toHaveBeenCalledTimes(14);
  });
  it("surfaces HTTP, RPC, contract and malformed-result failures", async () => {
    for (const response of [
      { ok: false, status: 503 },
      { ok: true, json: async () => ({ error: { message: "failed" } }) },
      { ok: true, json: async () => ({ result: { error: "panic" } }) },
      { ok: true, json: async () => ({ result: {} }) },
      { ok: true, json: async () => ({ result: { result: [123] } }) },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(viewFunction("http://localhost:3030", "core.testnet", "get_pool")).rejects.toThrow();
    }
  });
  it("uses the correct explorer network, without sandbox fake links", () => {
    expect(explorerTx("testnet", "abc")).toBe("https://testnet.nearblocks.io/txns/abc");
    expect(explorerAccount("mainnet", "core.near")).toBe("https://nearblocks.io/address/core.near");
    expect(explorerTx("sandbox", "abc")).toBeNull();
  });
});
