// Client-safe environment helpers. No server-only imports here.
import { NETWORKS, SAMPLE_NOW, type NearNetwork } from "@tradewind/core";
export { NETWORKS };
export function network(): NearNetwork {
  const value = process.env.NEXT_PUBLIC_NEAR_NETWORK || "testnet";
  if (value !== "testnet" && value !== "mainnet" && value !== "sandbox") throw new Error("Unsupported NEAR network");
  return value;
}
export function isFixtureMode(): boolean {
  const mode = process.env.NEXT_PUBLIC_DATA_SOURCE || "fixtures";
  if (mode !== "fixtures" && mode !== "rpc") throw new Error("NEXT_PUBLIC_DATA_SOURCE must be fixtures or rpc");
  return mode === "fixtures";
}
export function nowNs(): string { return isFixtureMode() ? SAMPLE_NOW : (BigInt(Date.now()) * 1_000_000n).toString(); }
export function contractHolder(): string { return process.env.NEXT_PUBLIC_CORE_CONTRACT_ID || "core.tradewind-demo.testnet"; }
