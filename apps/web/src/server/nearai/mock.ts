import "server-only";
import { hashBytes, type Proof } from "./client";
import { CHECK_IDS, type FormFields, type ModelResult } from "./prompt";
import { ApiError } from "../errors";
import { privateKeyToAccount } from "viem/accounts";
import { hashMessage } from "viem";
import { secp256k1 } from "@noble/curves/secp256k1";
import { env } from "../env";
// publicly known test key; never use for anything real; mock/sandbox only
export const PUBLIC_TEST_SIGNER_KEY = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";
export function assertMockNetwork(network: string) { if (network === "mainnet") throw new ApiError("Mock verdicts cannot be recorded on mainnet", 403); }
export function mockCompletion(form: FormFields, text: string, shipping?: string) {
  assertMockNetwork(env().NEAR_NETWORK);
  // Deliberately narrow, deterministic SAMPLE fixture parser. Never presented as AI inference.
  const find = (pattern: RegExp) => text.match(pattern)?.[1] ?? "";
  const total = find(/Total\s*:?\s*([\d.]+)\s*USDC/i);
  const items = [...text.matchAll(/W320\s+(\d+(?:\.\d+)?)\s+x\s+([\d.]+)\s*=\s*([\d.]+)/gi)];
  const buyer = find(/Buyer:\s*(.*?)\s*(?:Invoice:|TW-)/i);
  const tenor = Number(find(/Net\s+(\d+)/i));
  const result: ModelResult = { verdict: "fail", extracted: { invoice_number: find(/(TW-\d+)/), issue_date: find(/Issued:\s*(\d{4}-\d{2}-\d{2})/), due_date: find(/Due:\s*(\d{4}-\d{2}-\d{2})/), payment_terms_days: tenor, seller_name: find(/Seller:\s*(.*?)\s*Buyer:/i), buyer_name: buyer, currency: /USDC/.test(text) ? "USDC" : "", subtotal: total, tax: "0", total,
    line_items: items.map(i => ({ description: "cashew kernels W320", qty: i[1], unit_price: i[2], amount: i[3] })), goods: "cashew kernels W320", incoterm: "", ports: { loading: "", discharge: "" } },
    checks: CHECK_IDS.map(id => ({ id, ok: false, note: "MOCK fixture check" })), reasons: ["MOCK — not a TEE result"] };
  for (const c of result.checks) {
    if (c.id === "buyer_matches_form") c.ok = !!buyer && buyer === (form.buyer_label || form.buyer);
    if (c.id === "terms_consistent_with_dates") {
      const delta = Date.parse(result.extracted.due_date) - Date.parse(result.extracted.issue_date);
      c.ok = tenor === form.tenor_days && delta === tenor * 86_400_000;
    }
    if (c.id === "currency_supported") c.ok = result.extracted.currency === "USDC";
    if (c.id === "shipping_doc_consistent" || c.id === "no_obvious_tampering_signals") c.ok = true;
    if (c.id === "shipping_doc_consistent" && shipping) c.ok = !!buyer && shipping.includes(buyer) && /W320/i.test(shipping);
  }
  const request_hash = hashBytes(JSON.stringify({ form, text })), response_hash = hashBytes(JSON.stringify(result));
  const account = privateKeyToAccount(PUBLIC_TEST_SIGNER_KEY);
  const signedText = `mock/sample-parser:${request_hash}:${response_hash}`;
  // Synchronous EIP-191 signing preserves the deterministic fixture parser API.
  const signature = secp256k1.sign(hashMessage(signedText).slice(2), PUBLIC_TEST_SIGNER_KEY.slice(2));
  const proof: Proof = { model_id: "mock/sample-parser", request_hash, response_hash, chat_id: `mock-${request_hash.slice(0, 20)}`, signature: `0x${signature.toCompactHex()}${(27 + signature.recovery).toString(16)}`, signing_address: account.address, signing_algo: "ecdsa", signature_kind: "mock", text: signedText, verified_ok: false, mock: true, attestation_nonce: "", verification_reason: "MOCK — not a TEE result" };
  return { result, proof };
}
