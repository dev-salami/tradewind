import { store } from "@/server/db";
import { ApiError, jsonError } from "@/server/errors";
import { onChainInvoice } from "@/server/near/view";
import { env } from "@/server/env";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let chain;
    let chainFailed = false;
    try { chain = await onChainInvoice(id); } catch { chainFailed = true; }
    if (!chainFailed) {
      const proof = chain?.verification;
      if (!proof) throw new ApiError("Verification not found", 404);
      const { request_hash, response_hash, signature, signing_address, signing_algo, model_id, chat_id } = proof;
      let v;
      try { v = store().getVerification(id); } catch { /* Chain verification does not depend on the local cache. */ }
      const matches = v?.signature === signature && v?.model_id === model_id && v?.request_hash === request_hash && v?.response_hash === response_hash && v?.signing_address.toLowerCase() === signing_address.toLowerCase();
      return Response.json({ request_hash, response_hash, text: `${model_id}:${request_hash}:${response_hash}`, signature, signing_address, signing_algo, model_id, chat_id, mock: model_id.startsWith("mock/"), source: "chain", contract: env().CORE_CONTRACT_ID, attestation_summary: matches ? v?.attestation_summary : undefined }, { headers: { "Cache-Control": "no-store" } });
    }
    const v = store().getVerification(id);
    if (!v) throw new ApiError("Verification not found", 404);
    // Publish the signed payload, not invoice/document text or extracted private fields.
    const { request_hash, response_hash, text, signature, signing_address, signing_algo, signature_kind, model_id, chat_id, verified_ok, mock, attestation_nonce, tx_hash } = v;
    return Response.json({ request_hash, response_hash, text, signature, signing_address, signing_algo, signature_kind, model_id, chat_id, verified_ok, mock, attestation_nonce, tx_hash, source: "db", attestation_summary: v.attestation_summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return jsonError(e); }
}
