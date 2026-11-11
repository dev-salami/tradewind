// @vitest-environment node
import { expect, it } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { createEncryptionSession, encryptContent, decryptContent } from "../src/server/nearai/e2ee";
it("ECDSA E2EE request/response round trip and exact gateway headers", () => {
  const modelPrivate = secp256k1.utils.randomPrivateKey();
  const modelPublic = Buffer.from(secp256k1.getPublicKey(modelPrivate, false)).toString("hex");
  const client = createEncryptionSession(modelPublic.slice(2));
  expect(client.headers).toEqual({ "X-Signing-Algo": "ecdsa", "X-Client-Pub-Key": expect.stringMatching(/^04[a-f0-9]{128}$/), "X-Model-Pub-Key": modelPublic.slice(2), "X-Encryption-Version": "2", "x-no-aliasing": "true" });
  const request = client.encrypt("private invoice");
  expect(decryptContent(request, modelPrivate)).toBe("private invoice");
  const response = encryptContent("private result", client.headers["X-Client-Pub-Key"]);
  expect(client.decrypt(response)).toBe("private result");
  const tampered = `${response.slice(0, -2)}${response.endsWith("00") ? "01" : "00"}`;
  expect(() => client.decrypt(tampered)).toThrow();
  expect(() => client.decrypt("04")).toThrow();
});
