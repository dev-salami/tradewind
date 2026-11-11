import "server-only";
import { Account, KeyPair, keyStores, connect } from "near-api-js";
import { env } from "../env";
import { ApiError, NotConfiguredError } from "../errors";
import { assertMockNetwork } from "../nearai/mock";
import type { VerificationResult } from "../nearai/verify-flow";
import { store } from "../db";
export async function recordVerification(id: string, result: VerificationResult): Promise<string> {
  const e = env();
  if (result.mock) assertMockNetwork(e.NEAR_NETWORK);
  else if (!result.verified_ok) throw new ApiError("Unverified response cannot be attested", 422);
  if (!e.ATTESTER_PRIVATE_KEY || !e.ATTESTER_ACCOUNT_ID) throw new NotConfiguredError();
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(e.NEAR_NETWORK, e.ATTESTER_ACCOUNT_ID, KeyPair.fromString(e.ATTESTER_PRIVATE_KEY as `ed25519:${string}`));
  const near = await connect({ networkId: e.NEAR_NETWORK, nodeUrl: e.NEAR_RPC_URL, keyStore });
  const account = new Account(near.connection, e.ATTESTER_ACCOUNT_ID);
  const { verdict, model_id, request_hash, response_hash, signature, signing_address, signing_algo, chat_id } = result;
  const outcome = await account.functionCall({ contractId: e.CORE_CONTRACT_ID, methodName: "record_verification", args: { id, v: { verdict, model_id, request_hash, response_hash, signature, signing_address, signing_algo, chat_id, at: "0" } }, gas: 30_000_000_000_000n, attachedDeposit: 0n });
  const hash = outcome.transaction.hash;
  store().putTx(hash, e.ATTESTER_ACCOUNT_ID, id, "record_verification", "verify");
  return hash;
}
