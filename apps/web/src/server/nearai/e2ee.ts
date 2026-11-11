import "server-only";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";

const publicKey = (key: Uint8Array) => Buffer.from(secp256k1.getPublicKey(key, false)).toString("hex");
function derive(privateKey: Uint8Array, peer: Uint8Array) {
  const shared = secp256k1.getSharedSecret(privateKey, peer, false).slice(1, 33);
  return hkdf(sha256, shared, undefined, "ecdsa_encryption", 32);
}
export function encryptContent(content: string, recipientPublicKey: string): string {
  const ephemeral = secp256k1.utils.randomPrivateKey(), nonce = randomBytes(12);
  const key = derive(ephemeral, Buffer.from(recipientPublicKey.replace(/^0x/, ""), "hex"));
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  return Buffer.concat([Buffer.from(publicKey(ephemeral), "hex"), nonce, cipher.update(content, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("hex");
}
export function decryptContent(wireHex: string, privateKey: Uint8Array): string {
  if (!/^(?:[a-f0-9]{2})+$/i.test(wireHex)) throw new Error("Invalid encrypted content");
  const wire = Buffer.from(wireHex, "hex");
  if (wire.length < 93 || wire[0] !== 4) throw new Error("Invalid encrypted content");
  const decipher = createDecipheriv("aes-256-gcm", derive(privateKey, wire.subarray(0, 65)), wire.subarray(65, 77));
  decipher.setAuthTag(wire.subarray(-16));
  return Buffer.concat([decipher.update(wire.subarray(77, -16)), decipher.final()]).toString("utf8");
}
export function createEncryptionSession(modelPublicKey: string) {
  if (!/^[a-f0-9]{128}$/i.test(modelPublicKey)) throw new Error("Invalid model public key");
  const privateKey = secp256k1.utils.randomPrivateKey();
  return {
    headers: { "X-Signing-Algo": "ecdsa", "X-Client-Pub-Key": publicKey(privateKey), "X-Model-Pub-Key": modelPublicKey, "X-Encryption-Version": "2", "x-no-aliasing": "true" },
    encrypt: (content: string) => encryptContent(content, `04${modelPublicKey}`),
    decrypt: (content: string) => decryptContent(content, privateKey),
  };
}
