// Public Hardhat account #0. Test-only, never use this key for funds or attestation.
import { privateKeyToAccount } from "viem/accounts";
import { createHash } from "node:crypto";
const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const hash = text => createHash("sha256").update(text).digest("hex");
const model_id = "fixture/local-test-key", request_hash = hash("Tradewind fixture request"), response_hash = hash("Tradewind fixture response");
const text = `${model_id}:${request_hash}:${response_hash}`;
console.log(JSON.stringify({ model_id, request_hash, response_hash, text, signing_algo: "ecdsa", signature_kind: "fixture", signature: await account.signMessage({ message: text }), signing_address: account.address, chat_id: "fixture-local", mock: false, fixture: true }, null, 2));
