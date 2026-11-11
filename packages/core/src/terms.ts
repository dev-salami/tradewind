import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
export function sha256Hex(bytes: Uint8Array): string { return bytesToHex(sha256(bytes)); }
export interface HashTerms { exporter: string; buyer: string; invoice_number: string; face: string; tenor_days: number; doc_hash: string }
export function computeTermsHash(terms: HashTerms): string {
  const { exporter, buyer, invoice_number, face, tenor_days, doc_hash } = terms;
  // No whitespace, JSON, locale formatting, or implicit unit conversion in this preimage.
  return sha256Hex(new TextEncoder().encode(`tradewind:v1|${exporter}|${buyer}|${invoice_number}|${face}|${tenor_days}|${doc_hash}`));
}
