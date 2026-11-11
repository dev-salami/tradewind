import { store } from "@/server/db";
import { ApiError, jsonError } from "@/server/errors";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const v = store().getVerification(id);
    if (!v) throw new ApiError("Verification not found", 404);
    // Publish the signed payload, not invoice/document text or extracted private fields.
    const { request_hash, response_hash, text, signature, signing_address, signing_algo, signature_kind, model_id, chat_id, verified_ok, mock, attestation_nonce, tx_hash } = v;
    return Response.json({ request_hash, response_hash, text, signature, signing_address, signing_algo, signature_kind, model_id, chat_id, verified_ok, mock, attestation_nonce, tx_hash }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return jsonError(e); }
}
