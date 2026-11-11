import { GAS, parseAmount, type ContractTx } from "@/lib/tx";
import type { NearNetwork } from "@tradewind/core";

export function editableKeys(network: NearNetwork) {
  // There is no reminder-days field in the contract Config.
  return ["min_payment", "base_buyer_limit", ...(network === "sandbox" ? ["seconds_per_day"] : [])];
}
export function settingsPreview(config: Record<string, unknown>, key: string, input: string, network: NearNetwork) {
  if (Object.values(config).some(value => typeof value === "number" && !Number.isSafeInteger(value))) throw new Error("Config contains an unsafe JSON integer; refusing a lossy update");
  if (!editableKeys(network).includes(key) || !(key in config)) throw new Error("Setting is not editable on this network");
  let after: string | number;
  if (key === "seconds_per_day") {
    if (!/^\d+$/.test(input) || !Number.isSafeInteger(Number(input)) || Number(input) < 1 || Number(input) > 4294967295) throw new Error("Enter a positive u32 number of seconds");
    after = Number(input);
    if (BigInt(after) * 1000000000n * BigInt(Math.max(Number(config.default_after_days), Number(config.grace_days), 365)) > 2n ** 64n - 1n) throw new Error("Clock would overflow the contract timestamp");
  } else after = parseAmount(input);
  if (config[key] === after) throw new Error("No change to preview");
  return { key, before: config[key], after, original: { ...config }, config: { ...config, [key]: after } };
}
export function settingsTx(core: string, config: Record<string, unknown>): ContractTx {
  if (!core) throw new Error("Contract account is not configured");
  return { receiverId: core, actions: [{ type: "FunctionCall", params: { methodName: "set_config", args: { config }, gas: GAS.call, deposit: "1" } }] };
}
