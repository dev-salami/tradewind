import { fixtureData, rpcData, type TradewindData } from "@tradewind/core";
import { snapshotHistory } from "@/server/telegram/history";
import { isFixtureMode, network, NETWORKS } from "@/lib/env-public";
export { network, isFixtureMode, nowNs, contractHolder } from "@/lib/env-public";
export function data(): TradewindData {
  if (isFixtureMode()) return fixtureData();
  const contractId = process.env.NEXT_PUBLIC_CORE_CONTRACT_ID;
  if (!contractId) throw new Error("Set NEXT_PUBLIC_CORE_CONTRACT_ID for RPC mode");
  return { ...rpcData({ rpcUrl: process.env.NEXT_PUBLIC_NEAR_RPC_URL || process.env.NEAR_RPC_URL || NETWORKS[network()], contractId }), poolHistory: async () => snapshotHistory() };
}
