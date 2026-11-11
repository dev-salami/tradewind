import { Account, KeyPair, keyStores, connect } from "near-api-js";
import { viewFunction, type Invoice } from "@tradewind/core";
export class NotConfiguredError extends Error { constructor() { super("Signing key not configured"); this.name = "NotConfiguredError"; } }
export const rpc = () => process.env.NEAR_RPC_URL || (process.env.NEAR_NETWORK === "mainnet" ? "https://rpc.mainnet.near.org" : process.env.NEAR_NETWORK === "sandbox" ? "http://127.0.0.1:3030" : "https://rpc.testnet.near.org");
export function contract() { const id = process.env.CORE_CONTRACT_ID || process.env.NEXT_PUBLIC_CORE_CONTRACT_ID; if (!id) throw new NotConfiguredError(); return id; }
export const view = <T>(method: string, args: Record<string, unknown> = {}) => viewFunction<T>(rpc(), contract(), method, args);
export async function botCall(id: string, terms: string, amount: string) {
  const tx = await signedCall("BOT", "request_advance", { id, expected_terms_hash: terms, min_advance: amount });
  const invoice = await view<Invoice | null>("get_invoice", { id });
  // A successful top-level call can still revert its advance after a failed FT callback.
  if (!invoice?.advance || BigInt(invoice.advance.amount) < BigInt(amount) || !["Funded", "PartiallyPaid", "Repaid"].includes(invoice.status)) throw new Error("Advance not confirmed; check transaction");
  return tx;
}
export async function signedCall(role: "BOT" | "KEEPER", method: string, args: Record<string, unknown>) {
  const accountId = process.env[`${role}_ACCOUNT_ID`], key = process.env[`${role}_PRIVATE_KEY`];
  if (!accountId || !key) throw new NotConfiguredError();
  const networkId = process.env.NEAR_NETWORK || "testnet", keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(networkId, accountId, KeyPair.fromString(key as `ed25519:${string}`));
  const near = await connect({ networkId, nodeUrl: rpc(), keyStore });
  const account = new Account(near.connection, accountId);
  const result = await account.functionCall({ contractId: contract(), methodName: method, args, gas: 100_000_000_000_000n, attachedDeposit: 0n });
  if (typeof result.status === "object" && "Failure" in result.status) throw new Error("Advance transaction failed");
  return result.transaction.hash;
}
