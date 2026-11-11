#!/usr/bin/env node
import { pathToFileURL } from "node:url";

// Static capability list from contracts/tradewind/src/{admin,config,views,invoice}.rs.
export const METHODS = ["get_config", "get_roles", "get_pool", "list_invoices", "get_invoice", "get_tee_signers", "set_config", "pause", "unpause", "set_buyer_limit_override", "add_tee_signer", "remove_tee_signer", "cancel_invoice", "mark_overdue", "mark_default"];
const amounts = ["min_counted_face", "min_payment", "max_face", "base_buyer_limit"];
const signed = ["score_cap", "score_on_time", "score_grace", "score_late", "score_default"];
const unsigned = ["seconds_per_day", "fee_period_days", "base_rate_bps", "max_rate_bps", "rate_step_bps", "pool_fee_bps_per_30d", "protocol_fee_bps", "grace_days", "default_after_days", "limit_from_volume_bps", "max_single_advance_bps", "invoice_counter_start"];
export const CONFIG_KEYS = [...amounts, ...signed, ...unsigned, "paused", "require_tee_signature"];
const unsupported = () => new Error(`Unsupported command. Source-supported methods: ${METHODS.join(", ")}. Commands: status, config get|set <key> <value>, pause, unpause, buyer-limit <account> <usdc>, tee-signer add|remove <0xaddr>|list, cancel <id>, keeper run <id>.`);
export function usdc(value) {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) throw new Error("USDC requires at most six decimal places");
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  if (units > 2n ** 128n - 1n) throw new Error("USDC out of range");
  return String(units);
}
export function configValue(key, value) {
  if (!CONFIG_KEYS.includes(key)) throw new Error(`Editable keys: ${CONFIG_KEYS.join(", ")}. usdc is immutable.`);
  if (["paused", "require_tee_signature"].includes(key)) {
    if (!["true", "false"].includes(value)) throw new Error("Expected true or false");
    return value === "true";
  }
  if (!/^-?\d+$/.test(value)) throw new Error("Expected an integer (amounts use USDC base units)");
  const n = BigInt(value);
  if (amounts.includes(key)) {
    if (n < 0n || n >= 2n ** 128n) throw new Error("U128 out of range");
    return String(n);
  }
  const min = signed.includes(key) ? -(2n ** 31n) : 0n;
  const max = signed.includes(key) ? 2n ** 31n - 1n : key === "invoice_counter_start" ? BigInt(Number.MAX_SAFE_INTEGER) : 2n ** 32n - 1n;
  if (n < min || n > max) throw new Error("Integer out of range");
  return Number(n);
}
export function validateConfig(c) {
  if (Object.values(c).some(value => typeof value === "number" && !Number.isSafeInteger(value))) throw new Error("Config contains an unsafe JSON integer; refusing a lossy update");
  if (!(c.seconds_per_day > 0 && c.fee_period_days > 0)) throw new Error("Invalid clock");
  if (!(c.base_rate_bps <= c.max_rate_bps && c.max_rate_bps <= 10000)) throw new Error("Invalid rates");
  for (const key of ["max_single_advance_bps", "pool_fee_bps_per_30d", "protocol_fee_bps", "limit_from_volume_bps"]) if (c[key] > 10000) throw new Error("Invalid basis points");
  if (c.score_cap < 0 || c.score_on_time < 0 || c.score_grace < 0 || c.score_late > 0 || c.score_default > 0) throw new Error("Invalid scores");
  if (c.default_after_days < c.grace_days) throw new Error("Invalid default period");
  if (BigInt(c.seconds_per_day) * 1000000000n * BigInt(Math.max(c.default_after_days, c.grace_days, 365)) > 2n ** 64n - 1n) throw new Error("Clock overflow");
  for (const key of ["min_payment", "min_counted_face", "max_face"]) if (BigInt(c[key]) <= 0n) throw new Error("Invalid amount");
}
export function functionCall(contractId, methodName, args = {}, attachedDeposit = "1") {
  return { contractId, methodName, args, attachedDeposit, gas: "30000000000000" };
}
export function dryRun(call) {
  return `DRY-RUN account.functionCall(${JSON.stringify(call, null, 2)})`;
}
export async function buildCalls(words, contract, view, now) {
  const [command, sub, a, b] = words;
  if (["pause", "unpause"].includes(command) && words.length === 1) return [functionCall(contract, command)];
  if (command === "config" && sub === "set" && words.length === 4) {
    const value = configValue(a, b), config = { ...await view("get_config"), [a]: value };
    validateConfig(config);
    return [functionCall(contract, "set_config", { config })];
  }
  if (command === "buyer-limit" && words.length === 3) {
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(sub) || sub.length < 2 || sub.length > 64) throw new Error("Invalid account ID");
    return [functionCall(contract, "set_buyer_limit_override", { account_id: sub, limit: usdc(a) })];
  }
  if (command === "tee-signer" && ["add", "remove"].includes(sub) && words.length === 3) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error("Expected a 20-byte 0x address");
    return [functionCall(contract, `${sub}_tee_signer`, { address: a.toLowerCase() })];
  }
  if (command === "cancel" && words.length === 2) return [functionCall(contract, "cancel_invoice", { id: sub }, "0")];
  if (command === "keeper" && sub === "run" && words.length === 3) {
    const invoice = await view("get_invoice", { id: a });
    if (!invoice || !["Accepted", "Funded", "PartiallyPaid"].includes(invoice.status) || !invoice.due_at) throw new Error("Invoice is not keeper-eligible");
    const config = await view("get_config"), timestamp = BigInt(await now());
    const due = BigInt(invoice.due_at), deadline = due + BigInt(config.default_after_days) * BigInt(config.seconds_per_day) * 1000000000n;
    if (timestamp > deadline) return [functionCall(contract, "mark_default", { id: a }, "0")];
    if (timestamp > due && !invoice.overdue) return [functionCall(contract, "mark_overdue", { id: a }, "0")];
    return [];
  }
  throw unsupported();
}
export async function run(argv, env = process.env, log = console.log) {
  const flags = argv.filter(v => v.startsWith("--"));
  if (flags.some(v => !["--send", "--i-understand-mainnet"].includes(v))) throw unsupported();
  const words = argv.filter(v => !v.startsWith("--")), send = flags.includes("--send");
  const network = env.NEAR_NETWORK || "testnet";
  if (!["sandbox", "testnet", "mainnet"].includes(network)) throw new Error("Invalid NEAR_NETWORK");
  if (send && network === "mainnet" && !flags.includes("--i-understand-mainnet")) throw new Error("Mainnet --send requires --i-understand-mainnet");
  const contract = env.CORE_CONTRACT_ID;
  if (!contract) throw new Error("Set CORE_CONTRACT_ID");
  const url = env.NEAR_RPC_URL || (network === "sandbox" ? "http://127.0.0.1:3030" : `https://rpc.${network}.near.org`);
  const { providers, connect, keyStores, KeyPair } = await import("near-api-js");
  const provider = new providers.JsonRpcProvider({ url });
  const view = async (method, args = {}) => {
    try {
      const result = await provider.query({ request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
      return JSON.parse(Buffer.from(result.result).toString());
    } catch {
      throw new Error(`View ${method} unavailable (RPC failure or deployment mismatch). Source-supported methods: ${METHODS.join(", ")}`);
    }
  };
  if (words.join(" ") === "config get") { log(JSON.stringify(await view("get_config"), null, 2)); return; }
  if (words.join(" ") === "tee-signer list") { log(JSON.stringify(await view("get_tee_signers"), null, 2)); return; }
  if (words.join(" ") === "status") {
    const counts = {};
    for (let offset = 0; ; offset += 100) {
      const invoices = await view("list_invoices", { from_index: String(offset), limit: 100 });
      for (const i of invoices) counts[i.status] = (counts[i.status] || 0) + 1;
      if (invoices.length < 100) break;
    }
    let signers;
    try { signers = await view("get_tee_signers"); } catch { signers = "View unavailable; verify deployed contract version/RPC"; }
    log(JSON.stringify({ config: await view("get_config"), roles: await view("get_roles"), pool: await view("get_pool"), counts, tee_signers: signers }, null, 2)); return;
  }
  const calls = await buildCalls(words, contract, view, async () => (await provider.block({ finality: "final" })).header.timestamp_nanosec);
  for (const call of calls) log(dryRun(call));
  if (!calls.length) { log("No keeper action is currently eligible."); return; }
  if (!send) return;
  if (!env.OWNER_ACCOUNT_ID || !env.OWNER_PRIVATE_KEY) throw new Error("--send requires OWNER_ACCOUNT_ID and OWNER_PRIVATE_KEY from environment");
  try {
    const store = new keyStores.InMemoryKeyStore();
    await store.setKey(network, env.OWNER_ACCOUNT_ID, KeyPair.fromString(env.OWNER_PRIVATE_KEY));
    const near = await connect({ networkId: network, nodeUrl: url, keyStore: store });
    const account = await near.account(env.OWNER_ACCOUNT_ID);
    for (const call of calls) {
      const result = await account.functionCall({ ...call, gas: BigInt(call.gas), attachedDeposit: BigInt(call.attachedDeposit) });
      if (result.status && typeof result.status === "object" && "Failure" in result.status) throw new Error("Transaction failed");
      log(`Sent transaction: ${result.transaction.hash}`);
    }
  } catch { throw new Error("Send failed. Check account permissions, contract version, balance and RPC; inspect chain receipts before retrying."); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
