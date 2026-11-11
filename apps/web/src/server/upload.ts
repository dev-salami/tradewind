import "server-only";
import { ApiError } from "./errors";
import { extractPdf, MAX_PDF_BYTES, validatePdf } from "./pdf";
export async function readMultipart(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new ApiError("Expected multipart form data");
  // Bound the whole multipart body before parsing, even for chunked requests.
  const max = MAX_PDF_BYTES * 2 + 64 * 1024;
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("Missing upload body");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > max) { await reader.cancel(); throw new ApiError("Upload exceeds size limit", 413); } chunks.push(part.value); }
    const bytes = Buffer.concat(chunks);
    try { return await new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type")! }, body: bytes }).formData(); }
    catch { throw new ApiError("Invalid multipart body"); }
    finally { bytes.fill(0); }
  } finally { chunks.forEach(c => c.fill(0)); reader.releaseLock(); }
}
export async function pdfUpload(value: FormDataEntryValue | null, required = true) {
  if (!value && !required) return undefined;
  if (!value || typeof value === "string") throw new ApiError("PDF file required");
  if (value.size > MAX_PDF_BYTES) throw new ApiError("PDF exceeds 5 MB", 413);
  const bytes = new Uint8Array(await value.arrayBuffer());
  try {
    validatePdf(bytes);
    const result = await extractPdf(bytes);
    if (result.scanned) throw new ApiError("scanned PDFs need the vision model", 422);
    return { text: result.text, bytes };
  } catch (e) { bytes.fill(0); throw e; }
}
