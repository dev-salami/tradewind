import "server-only";
import { env } from "../env";
import { extractPdf, renderPdfPages } from "../pdf";
import { ApiError } from "../errors";
import { liveCompletion } from "./client";
import { mockCompletion } from "./mock";
import { recomputeLineItemSum, recomputeVerdict } from "./verdict";
import type { FormFields } from "./prompt";
import { hashBytes } from "./client";
export function verificationInputHash(text: string, shipping: string | undefined, form: FormFields) {
  const canonical = Object.fromEntries(Object.entries(form).sort(([a], [b]) => a.localeCompare(b)));
  return hashBytes(JSON.stringify([text, shipping ?? "", canonical]));
}
export async function runVerification(input: { invoiceId: string; pdfBytes?: Uint8Array; text?: string; shippingText?: string; formFields: FormFields }) {
  try {
    let text = input.text;
    let images: string[] | undefined, scanned = false;
    if (input.pdfBytes) {
      const pdf = await extractPdf(input.pdfBytes);
      scanned = pdf.scanned;
      if (scanned && env().AI_MODE !== "mock") images = await renderPdfPages(input.pdfBytes);
      text = pdf.text || (scanned ? "Scanned invoice: read attached pages." : "");
    }
    if (!text?.trim()) throw new ApiError("Invoice text is empty");
    const { result, proof } = env().AI_MODE === "mock" ? await mockCompletion(input.formFields, text, input.shippingText) : await liveCompletion(input.formFields, text, input.shippingText, images);
    if (scanned && proof.mock) {
      result.reasons.push("MOCK vision — scanned PDF not read");
      result.checks = result.checks.map(c => c.id === "no_obvious_tampering_signals" ? { ...c, ok: false, note: "MOCK vision — scanned PDF not read" } : c);
    }
    const arithmetic = recomputeLineItemSum(result.extracted, input.formFields.face);
    const checks = result.checks.map(c => arithmetic.find(a => a.id === c.id) ?? c);
    const reasons = [...new Set([...result.reasons, ...checks.filter(c => !c.ok).map(c => c.note), ...(!proof.verified_ok ? [proof.verification_reason] : [])])];
    return { ...proof, scanned, input_hash: verificationInputHash(text, input.shippingText, input.formFields), verdict: recomputeVerdict(checks), extracted: result.extracted, checks, reasons };
  } finally {
    // D5: PDF bytes are never persisted. Erase the caller-owned upload buffer even on errors.
    input.pdfBytes?.fill(0);
  }
}
export type VerificationResult = Awaited<ReturnType<typeof runVerification>>;
