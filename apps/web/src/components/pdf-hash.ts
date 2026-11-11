/** Fingerprint the exact PDF bytes locally; no document content leaves the browser. */
export async function hashPdf(file: Pick<Blob, "arrayBuffer">): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
