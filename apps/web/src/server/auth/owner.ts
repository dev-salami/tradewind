import "server-only";
import { viewFunction } from "@tradewind/core";
import { getSession } from "./session";

/** The session is authenticated; a connected wallet alone is not an admin session. */
export async function isOwner(request: Request): Promise<boolean> {
  const session = getSession(request);
  if (!session) return false;
  const fixture = (process.env.NEXT_PUBLIC_DATA_SOURCE || "fixtures") === "fixtures";
  if (fixture && process.env.NEXT_PUBLIC_SHOW_OPS !== "1") return false;
  let owner = process.env.OWNER_ACCOUNT_ID;
  const contract = process.env.CORE_CONTRACT_ID || process.env.NEXT_PUBLIC_CORE_CONTRACT_ID;
  if (!fixture && contract) {
    const network = process.env.NEAR_NETWORK || process.env.NEXT_PUBLIC_NEAR_NETWORK || "testnet";
    const rpc = process.env.NEAR_RPC_URL || process.env.NEXT_PUBLIC_NEAR_RPC_URL || (network === "sandbox" ? "http://127.0.0.1:3030" : `https://rpc.${network}.near.org`);
    try {
      const config = await viewFunction<{ owner?: string }>(rpc, contract, "get_config", {});
      owner = config.owner || (await viewFunction<{ owner: string }>(rpc, contract, "get_roles", {})).owner || owner;
    } catch { return false; } // Never grant access from a stale env owner on RPC failure.
  }
  return !!owner && session.accountId === owner;
}
