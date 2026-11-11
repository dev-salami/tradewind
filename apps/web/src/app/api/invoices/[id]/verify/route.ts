import { store } from "@/server/db";
import { ApiError, jsonError } from "@/server/errors";
import { onChainInvoice } from "@/server/near/view";
import { recordVerification } from "@/server/near/attester";
import { formSchema } from "@/server/nearai/prompt";
import { runVerification, verificationInputHash, type VerificationResult } from "@/server/nearai/verify-flow";
import { assertMockNetwork } from "@/server/nearai/mock";
import { env } from "@/server/env";
export const runtime = "nodejs";
const active = new Set<string>();
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let locked = false, draftId: string | undefined;
  try {
    let body;
    try { body = await request.json(); } catch { throw new ApiError("Invalid JSON body"); }
    if (!body || typeof body.draft_id !== "string") throw new ApiError("draft_id required");
    if (active.has(id)) throw new ApiError("Verification in progress", 409);
    active.add(id); locked = true;
    const draft = store().getDraft(body.draft_id);
    if (!draft) throw new ApiError("Draft missing or expired", 404);
    const invoice = await onChainInvoice(id);
    if (!invoice) throw new ApiError("Invoice not found", 404);
    if (invoice.status !== "Created") throw new ApiError("Invoice must have status Created", 409);
    if (invoice.doc_hash !== draft.doc_hash) throw new ApiError("Document hash mismatch", 409);
    if (draft.exporter && invoice.exporter !== draft.exporter) throw new ApiError("Exporter mismatch", 403);
    draftId = draft.draft_id;
    if (env().AI_MODE === "mock") assertMockNetwork(env().NEAR_NETWORK);
    const formFields = formSchema.parse(invoice);
    const cached = (JSON.parse(draft.extracted_json) as { verification?: VerificationResult }).verification;
    const unchanged = cached?.input_hash === verificationInputHash(draft.text, draft.shipping_text, formFields);
    if (!unchanged && cached?.scanned) throw new ApiError("Scanned invoice fields changed; upload a new draft", 409);
    const result = unchanged ? cached! : await runVerification({ invoiceId: id, text: draft.text, shippingText: draft.shipping_text, formFields });
    store().putVerification(id, result, null);
    if (!result.verified_ok && !result.mock) throw new ApiError(`Unverified response: ${result.verification_reason}`, 422);
    const tx_hash = await recordVerification(id, result);
    store().putVerification(id, result, tx_hash);
    store().audit("record_verification", id, JSON.stringify({ verdict: result.verdict, mock: result.mock, tx_hash }));
    const { verdict, reasons, signature, signing_address, model_id, mock } = result;
    return Response.json({ verdict, reasons, tx_hash, signature, signing_address, model_id, mock });
  } catch (e) { return jsonError(e); }
  finally { if (draftId) store().deleteDraft(draftId); if (locked) active.delete(id); }
}
