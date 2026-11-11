// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
// @ts-expect-error The CLI is intentionally standalone JavaScript.
import { buildCalls, configValue, dryRun, run, usdc } from "../../../scripts/admin.mjs";

const config = { usdc: "usdc.testnet", seconds_per_day: 10, fee_period_days: 30, base_rate_bps: 7000, max_rate_bps: 8500, rate_step_bps: 100, score_cap: 15, score_on_time: 3, score_grace: 1, score_late: -3, score_default: -15, pool_fee_bps_per_30d: 75, protocol_fee_bps: 50, grace_days: 7, default_after_days: 30, min_counted_face: "1000000", min_payment: "1000000", max_face: "50000000", base_buyer_limit: "10000000", limit_from_volume_bps: 5000, max_single_advance_bps: 5000, invoice_counter_start: 35, paused: false, require_tee_signature: false };
const env = { CORE_CONTRACT_ID: "core.testnet", NEAR_NETWORK: "testnet", NEAR_RPC_URL: "https://rpc.test.invalid" };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("admin CLI", () => {
  it("builds exact owner calls and prints complete dry-run calls", async () => {
    const [call] = await buildCalls(["pause"], env.CORE_CONTRACT_ID);
    expect(call).toEqual({ contractId: "core.testnet", methodName: "pause", args: {}, attachedDeposit: "1", gas: "30000000000000" });
    expect(dryRun(call)).toBe(`DRY-RUN account.functionCall(${JSON.stringify(call, null, 2)})`);
    const log = vi.fn();
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await run(["unpause"], { ...env, OWNER_PRIVATE_KEY: "never-print-this" }, log);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toContain('"methodName": "unpause"');
    expect(log.mock.calls[0][0]).not.toContain("never-print-this");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("merges only supported config keys into the full current config", async () => {
    const view = vi.fn().mockResolvedValue(config);
    const [call] = await buildCalls(["config", "set", "min_payment", "2000000"], "core.testnet", view);
    expect(view).toHaveBeenCalledWith("get_config");
    expect(call.args).toEqual({ config: { ...config, min_payment: "2000000" } });
    expect(config.min_payment).toBe("1000000");
    expect(() => configValue("usdc", "other.testnet")).toThrow("immutable");
    expect(() => configValue("require_tee_signature", "yes")).toThrow();
    expect(configValue("require_tee_signature", "true")).toBe(true);
    expect(configValue("score_late", "-4")).toBe(-4);
    expect(() => configValue("grace_days", "-1")).toThrow();
    await expect(buildCalls(["config", "set", "seconds_per_day", "4294967295"], "core.testnet", view)).rejects.toThrow("Clock overflow");
  });
  it("builds buyer, signer, and cancellation argument shapes", async () => {
    expect(usdc("12.345678")).toBe("12345678");
    expect(() => usdc("1.0000001")).toThrow();
    expect((await buildCalls(["buyer-limit", "buyer.testnet", "12.5"], "core"))[0].args).toEqual({ account_id: "buyer.testnet", limit: "12500000" });
    for (const action of ["add", "remove"]) {
      const [call] = await buildCalls(["tee-signer", action, `0x${"AB".repeat(20)}`], "core");
      expect(call.methodName).toBe(`${action}_tee_signer`);
      expect(call.args).toEqual({ address: `0x${"ab".repeat(20)}` });
    }
    expect((await buildCalls(["cancel", "TW-0042"], "core"))[0]).toMatchObject({ methodName: "cancel_invoice", args: { id: "TW-0042" }, attachedDeposit: "0" });
  });
  it("uses chain time and strict keeper eligibility boundaries", async () => {
    const invoice = { status: "Funded", due_at: "100", overdue: false };
    const view = vi.fn(async (method: string) => method === "get_config" ? { default_after_days: 1, seconds_per_day: 1 } : invoice);
    const calls = (time: string) => buildCalls(["keeper", "run", "TW-0042"], "core", view, async () => time);
    expect(await calls("100")).toEqual([]);
    expect((await calls("101"))[0]).toMatchObject({ methodName: "mark_overdue", attachedDeposit: "0" });
    expect((await calls("1000000101"))[0].methodName).toBe("mark_default");
    invoice.overdue = true;
    expect(await calls("101")).toEqual([]);
    invoice.status = "Paid";
    await expect(calls("101")).rejects.toThrow("not keeper-eligible");
  });
  it("refuses mainnet sending, unknown commands, flags and missing keys", async () => {
    await expect(run(["pause", "--send"], { ...env, NEAR_NETWORK: "mainnet" })).rejects.toThrow("--i-understand-mainnet");
    await expect(run(["pause", "--send", "--i-understand-mainnet"], { ...env, NEAR_NETWORK: "mainnet" }, vi.fn())).rejects.toThrow("OWNER_ACCOUNT_ID and OWNER_PRIVATE_KEY");
    await expect(run(["pause", "--force"], env)).rejects.toThrow("Source-supported methods");
    await expect(buildCalls(["unknown"], "core")).rejects.toThrow("set_buyer_limit_override");
  });
  it("reads status with paginated counts, config, pool and signer views", async () => {
    const methods: string[] = [];
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const rpc = JSON.parse(Buffer.concat(chunks).toString());
      const method = rpc.params.method_name;
      methods.push(method);
      const args = JSON.parse(Buffer.from(rpc.params.args_base64, "base64").toString());
      const result = method === "get_config" ? config : method === "get_roles" ? { owner: "owner.testnet" } : method === "get_pool" ? { cash: "123" } : method === "get_tee_signers" ? [`0x${"11".repeat(20)}`] : args.from_index === "0" ? Array.from({ length: 100 }, () => ({ status: "Funded" })) : [{ status: "Paid" }];
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { result: [...Buffer.from(JSON.stringify(result))] } }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const log = vi.fn();
      const rpcEnv = { ...env, NEAR_RPC_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
      await run(["status"], rpcEnv, log);
      expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ config, pool: { cash: "123" }, counts: { Funded: 100, Paid: 1 }, tee_signers: [`0x${"11".repeat(20)}`] });
      expect(methods.filter(method => method === "list_invoices")).toHaveLength(2);
      await run(["config", "get"], rpcEnv, log);
      expect(JSON.parse(log.mock.calls[1][0])).toEqual(config);
      await run(["tee-signer", "list"], rpcEnv, log);
      expect(JSON.parse(log.mock.calls[2][0])).toEqual([`0x${"11".repeat(20)}`]);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
