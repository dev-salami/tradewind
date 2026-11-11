import { randomUUID } from "node:crypto";
import { store } from "@/server/db";
import { ApiError, jsonError } from "@/server/errors";
import { hashBytes } from "@/server/nearai/client";
import { formSchema } from "@/server/nearai/prompt";
import { runVerification } from "@/server/nearai/verify-flow";
import { allowRequest } from "@/server/rate-limit";
import { readMultipart } from "@/server/upload";
import { extractPdf, MAX_PDF_BYTES } from "@/server/pdf";
async function pdfUpload(value: FormDataEntryValue | null, required = true) {
  if (!value && !required) return undefined;
  if (!value || typeof value === "string") throw new ApiError("PDF file required");
  if (value.size > MAX_PDF_BYTES) throw new ApiError("PDF exceeds 5 MB", 413);
  const bytes = new Uint8Array(await value.arrayBuffer());
  try { return { ...await extractPdf(bytes), bytes }; }
  catch (e) { bytes.fill(0); throw e; }
}
export const runtime = "nodejs";
export async function POST(request: Request) {
  let invoice: Awaited<ReturnType<typeof pdfUpload>>, shipping: Awaited<ReturnType<typeof pdfUpload>>;
  try {
    // Deployment must overwrite x-forwarded-for at the trusted reverse proxy.
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    if (!allowRequest(ip)) throw new ApiError("Rate limit exceeded (10/min)", 429);
    const multipart = await readMultipart(request);
    let raw: unknown;
    try { raw = JSON.parse(String(multipart.get("form_fields") ?? multipart.get("fields") ?? "{}")); } catch { throw new ApiError("Invalid form fields JSON"); }
    const parsed = formSchema.safeParse(raw);
    if (!parsed.success) throw new ApiError("Invalid form fields");
    invoice = await pdfUpload(multipart.get("file"));
    shipping = await pdfUpload(multipart.get("shipping"), false);
    const doc_hash = hashBytes(invoice!.bytes), draft_id = randomUUID();
    const result = await runVerification({ invoiceId: draft_id, text: invoice!.text, pdfBytes: invoice!.scanned ? invoice!.bytes : undefined, shippingText: shipping?.text, formFields: parsed.data });
    if (invoice!.scanned && !invoice!.text) invoice!.text = "Scanned invoice: read attached pages.";
    store().putDraft({ draft_id, exporter: parsed.data.exporter, doc_hash, text: invoice!.text, shipping_text: shipping?.text ?? "", extracted_json: JSON.stringify({ extracted: result.extracted, verification: result }), created_at: Date.now(), expires_at: Date.now() + 3_600_000 });
    return Response.json({ draft_id, doc_hash, extracted: result.extracted, checks: result.checks, verdict_preview: result.verdict, reasons: result.reasons, signature: result.signature, mock: result.mock, verified_ok: result.verified_ok, model_id: result.model_id });
  } catch (e) { return jsonError(e); }
  finally { invoice?.bytes.fill(0); shipping?.bytes.fill(0); }
}
