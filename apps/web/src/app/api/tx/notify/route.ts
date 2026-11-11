import { z } from "zod";
import { store } from "@/server/db";
import { txStatus, coreId, usdcId } from "@/lib/near";
import { invoiceCreatedId } from "@/lib/wallet-logic";
import { jsonError, ApiError } from "@/server/errors";
export const runtime = "nodejs";
const notification = z.object({ tx_hash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/), account_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$/) });
export async function POST(request: Request) {
  try {
    const parsed = notification.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("Invalid transaction notification");
    const { tx_hash, account_id } = parsed.data;
    // Persist first, so an RPC outage cannot lose the notification.
    store().putTx(tx_hash, account_id, null);
    const result = await txStatus(tx_hash, account_id);
    if (result.transaction?.signer_id !== account_id) throw new ApiError("Transaction signer mismatch", 400);
    const receiver = result.transaction?.receiver_id;
    if (receiver !== coreId() && receiver !== usdcId()) throw new ApiError("Unrelated transaction", 400);
    let id = receiver === coreId() ? invoiceCreatedId(result) : undefined;
    for (const action of result.transaction?.actions || []) {
      const call = action.FunctionCall;
      if (!call?.args) continue;
      try {
        const args = JSON.parse(Buffer.from(call.args, "base64").toString("utf8"));
        const message = typeof args.msg === "string" ? JSON.parse(args.msg) : {};
        if (receiver === coreId() || args.receiver_id === coreId()) id ??= args.id || args.invoice_id || message.invoice_id;
      } catch { /* Not an invoice action. */ }
    }
    const invoiceId = typeof id === "string" && /^TW-\d+$/.test(id) ? id : null;
    store().putTx(tx_hash, account_id, invoiceId);
    return Response.json({ ok: true, invoice_id: invoiceId });
  } catch (e) { return jsonError(e); }
}
