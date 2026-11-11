import "server-only";
import { ApiError } from "./errors";
export const MAX_PDF_BYTES = 5 * 1024 * 1024;
export function validatePdf(bytes: Uint8Array) {
  if (bytes.length > MAX_PDF_BYTES) throw new ApiError("PDF exceeds 5 MB", 413);
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new ApiError("Invalid PDF magic bytes");
}
export async function extractPdf(bytes: Uint8Array): Promise<{ text: string; scanned: boolean }> {
  validatePdf(bytes);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: bytes.slice(), useSystemFonts: true, isEvalSupported: false });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    let scanned = false;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = content.items.map(item => "str" in item ? item.str : "").join(" ");
      if (!text.trim()) scanned = true;
      pages.push(text); page.cleanup();
    }
    if (!pages.length) throw new ApiError("PDF has no pages");
    return { text: pages.join("\n"), scanned };
  } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError("Unable to read PDF"); }
  finally { await task.destroy(); }
}
