import { Buffer } from "buffer";

interface SignInWallet {
  signMessage?(params: { message: string; nonce: Buffer; recipient: string }): Promise<{ accountId: string; publicKey: string; signature: string } | void>;
}
// Exported for the wallet UI; this module does not initiate sign-in on import.
export async function signIn(wallet: SignInWallet): Promise<{ accountId: string }> {
  if (!wallet.signMessage) throw new Error("Wallet does not support message signing");
  const challengeResponse = await fetch("/api/auth/nonce", { method: "POST", credentials: "same-origin" });
  if (!challengeResponse.ok) throw new Error("Could not create sign-in challenge");
  const challenge = await challengeResponse.json();
  const signed = await wallet.signMessage({ message: challenge.message, nonce: Buffer.from(challenge.nonce, "base64"), recipient: challenge.recipient });
  if (!signed) throw new Error("Wallet sign-in cancelled");
  const response = await fetch("/api/auth/verify", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature, nonce: challenge.nonce }),
  });
  if (!response.ok) throw new Error("Wallet sign-in failed");
  return response.json();
}
