import { fixtureData, rpcData, NETWORKS, SAMPLE_NOW, type NearNetwork, type TradewindData } from "@tradewind/core";
import { snapshotHistory } from "@/server/telegram/history";
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
export function data(): TradewindData {
  if (isFixtureMode()) return fixtureData();
  const contractId = process.env.NEXT_PUBLIC_CORE_CONTRACT_ID;
  if (!contractId) throw new Error("Set NEXT_PUBLIC_CORE_CONTRACT_ID for RPC mode");
  return { ...rpcData({ rpcUrl: process.env.NEAR_RPC_URL || NETWORKS[network()], contractId }), poolHistory: async () => snapshotHistory() };
}
export function nowNs(): string { return isFixtureMode() ? SAMPLE_NOW : (BigInt(Date.now()) * 1_000_000n).toString(); }
export function contractHolder(): string { return process.env.NEXT_PUBLIC_CORE_CONTRACT_ID || "core.tradewind-demo.testnet"; }
