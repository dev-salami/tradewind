import type { TxOutcome } from "@/lib/wallet-logic";
import { invoiceCreatedId } from "@/lib/wallet-logic";
import type { TxKind } from "@/lib/receipt-txs";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function message(args: Record<string, unknown>): Record<string, unknown> {
  try { return typeof args.msg === "string" ? object(JSON.parse(args.msg)) : {}; } catch { return {}; }
}
export function methodKind(method: string, args: Record<string, unknown> = {}): TxKind {
  switch (method) {
    case "create_invoice": return "create";
    case "record_verification": return "verify";
    case "accept_invoice": return "accept";
    case "request_advance": return "advance";
    case "claim": return "claim";
    case "ft_transfer_call": return message(args).action === "repay" ? "repay" : "other";
    default: return "other";
  }
}
// Only call after checking the transaction's signer and receiver with RPC.
export function transactionMetadata(result: TxOutcome, core: string) {
  const direct = result.transaction?.receiver_id === core;
  let invoice = direct ? invoiceCreatedId(result) : undefined;
  let method: string | null = null;
  let kind: TxKind = "other";
  for (const action of result.transaction?.actions ?? []) {
    const call = action.FunctionCall;
    if (!call?.method_name) continue;
    let args: Record<string, unknown> = {};
    try { args = object(JSON.parse(Buffer.from(call.args ?? "", "base64").toString("utf8"))); } catch { /* Keep the real method even if args cannot be decoded. */ }
    const relevant = direct || args.receiver_id === core;
    const candidate = relevant ? methodKind(call.method_name, args) : "other";
    if (method === null || (kind === "other" && candidate !== "other")) { method = call.method_name; kind = candidate; }
    if (relevant) {
      const id = args.id ?? args.invoice_id ?? message(args).invoice_id;
      if (typeof id === "string" && /^TW-\d+$/.test(id)) invoice ??= id;
    }
  }
  return { invoice_id: invoice ?? null, method, kind };
}
