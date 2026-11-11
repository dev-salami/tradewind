import "server-only";
import { env } from "../env";
import { extractPdf } from "../pdf";
import { ApiError } from "../errors";
import { liveCompletion } from "./client";
import { mockCompletion } from "./mock";
import { recomputeLineItemSum, recomputeVerdict } from "./verdict";
import type { FormFields } from "./prompt";
export async function runVerification(input: { invoiceId: string; pdfBytes?: Uint8Array; text?: string; shippingText?: string; formFields: FormFields }) {
  try {
    let text = input.text;
    if (input.pdfBytes) {
      const pdf = await extractPdf(input.pdfBytes);
      if (pdf.scanned) throw new ApiError("scanned PDFs need the vision model", 422); // TODO_VISION: render and send scanned pages to the vision model.
      text = pdf.text;
    }
    if (!text?.trim()) throw new ApiError("Invoice text is empty");
    const { result, proof } = env().AI_MODE === "mock" ? mockCompletion(input.formFields, text, input.shippingText) : await liveCompletion(input.formFields, text, input.shippingText);
    const arithmetic = recomputeLineItemSum(result.extracted, input.formFields.face);
    const checks = result.checks.map(c => arithmetic.find(a => a.id === c.id) ?? c);
    const reasons = [...new Set([...result.reasons, ...checks.filter(c => !c.ok).map(c => c.note), ...(!proof.verified_ok ? [proof.verification_reason] : [])])];
    return { ...proof, verdict: recomputeVerdict(checks), extracted: result.extracted, checks, reasons };
  } finally {
    // D5: PDF bytes are never persisted. Erase the caller-owned upload buffer even on errors.
    input.pdfBytes?.fill(0);
  }
}
export type VerificationResult = Awaited<ReturnType<typeof runVerification>>;
