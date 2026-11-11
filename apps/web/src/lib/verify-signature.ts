import { recoverMessageAddress, type Hex } from "viem";
/** Public, well-known test key used only for MOCK verdicts; never a TEE signer. */
export const MOCK_TEST_SIGNER = "0x2c7536e3605d9c16a7a3d7b1898e529396a65c23";
/** True for verdicts produced by the local mock (old "mock" algo, mock model id, or the public test key). */
export function isMockVerification(v: { signing_algo?: string; model_id?: string; signing_address?: string }): boolean {
  return v.signing_algo === "mock" || !!v.model_id?.startsWith("mock/") || v.signing_address?.toLowerCase() === MOCK_TEST_SIGNER;
}
export interface PublicProof { text: string; model_id: string; request_hash: string; response_hash: string; signing_algo: string; signature: string; signing_address: string; mock?: boolean; fixture?: boolean; source?: "chain" | "db"; contract?: string; attestation_summary?: { steps: { id: string; ok: boolean; detail: string }[] } }
export async function verifyPublicSignature(proof: PublicProof): Promise<void> {
  if (proof.signing_algo !== "ecdsa") throw new Error("Unsupported signing algorithm");
  if (proof.text !== `${proof.model_id}:${proof.request_hash}:${proof.response_hash}`) throw new Error("Signature text mismatch");
  let address: string;
  try { address = await recoverMessageAddress({ message: proof.text, signature: proof.signature as Hex }); }
  catch { throw new Error("Invalid EIP-191 signature"); }
  if (address.toLowerCase() !== proof.signing_address.toLowerCase()) throw new Error("Recovered signer mismatch");
  if (proof.mock && address.toLowerCase() !== MOCK_TEST_SIGNER) throw new Error("MOCK signer is not the public test key");
}
