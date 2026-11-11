import "server-only";
import { Account, KeyPair, keyStores, connect } from "near-api-js";
import { guidedConfig } from "./config";
import { decryptGuidedKey, type GuidedSession } from "./session-store";

const pending = new Map<string, Promise<void>>();
export async function withAccountLock<T>(accountId: string, work: () => Promise<T>): Promise<T> {
  const previous = pending.get(accountId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  pending.set(accountId, next);
  await previous;
  try { return await work(); }
  finally { release(); if (pending.get(accountId) === next) pending.delete(accountId); }
}

export async function withGuidedSigner<T>(role: "exporter" | "buyer", work: (account: Account) => Promise<T>, session?: GuidedSession): Promise<T> {
  const config = guidedConfig(), accountId = role === "buyer" && session ? session.buyer_account : config[role];
  return withAccountLock(accountId, async () => {
    const e = guidedConfig();
    const keyStore = new keyStores.InMemoryKeyStore();
    const key = role === "exporter" ? e.exporterKey : session ? decryptGuidedKey(session.encrypted_key) : e.buyerKey;
    await keyStore.setKey(e.NEAR_NETWORK, accountId, KeyPair.fromString(key as `ed25519:${string}`));
    const near = await connect({ networkId: e.NEAR_NETWORK, nodeUrl: e.NEAR_RPC_URL, keyStore });
    return work(new Account(near.connection, accountId));
  });
}
