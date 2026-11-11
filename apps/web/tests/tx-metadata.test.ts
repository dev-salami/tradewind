// @vitest-environment node
import { describe, expect, it } from "vitest";
import { transactionMetadata } from "../src/server/near/tx-metadata";
import type { TxOutcome } from "../src/lib/wallet-logic";

function outcome(method: string, args: object, receiver = "core.testnet"): TxOutcome {
  return { transaction: { signer_id: "sample.testnet", receiver_id: receiver, actions: [{ FunctionCall: { method_name: method, args: Buffer.from(JSON.stringify(args)).toString("base64") } }] } };
}
describe("metadata from verified FunctionCall actions", () => {
  it.each([
    ["create_invoice", "create"], ["record_verification", "verify"], ["accept_invoice", "accept"],
    ["request_advance", "advance"], ["claim", "claim"], ["cancel_invoice", "other"],
  ])("derives %s as %s", (method, kind) => {
    expect(transactionMetadata(outcome(method, { id: "TW-0042" }), "core.testnet")).toEqual({ method, kind, invoice_id: "TW-0042" });
  });
  it("takes the created id from real event logs", () => {
    const tx = outcome("create_invoice", {});
    tx.receipts_outcome = [{ outcome: { logs: ['EVENT_JSON:{"standard":"tradewind","event":"invoice_created","data":[{"invoice_id":"TW-0042"}]}'] } }];
    expect(transactionMetadata(tx, "core.testnet")).toEqual({ invoice_id: "TW-0042", method: "create_invoice", kind: "create" });
  });
  it("recognizes repay only when the FT message targets this contract", () => {
    const args = { receiver_id: "core.testnet", msg: JSON.stringify({ action: "repay", invoice_id: "TW-0042" }) };
    expect(transactionMetadata(outcome("ft_transfer_call", args, "usdc.testnet"), "core.testnet")).toEqual({ invoice_id: "TW-0042", method: "ft_transfer_call", kind: "repay" });
    expect(transactionMetadata(outcome("ft_transfer_call", { ...args, receiver_id: "elsewhere.testnet" }, "usdc.testnet"), "core.testnet")).toEqual({ invoice_id: null, method: "ft_transfer_call", kind: "other" });
    expect(transactionMetadata(outcome("ft_transfer_call", { ...args, msg: '{"action":"deposit"}' }, "usdc.testnet"), "core.testnet").kind).toBe("other");
  });
  it("handles malformed messages, absent actions and invalid ids without inventing metadata", () => {
    expect(transactionMetadata(outcome("ft_transfer_call", { receiver_id: "core.testnet", msg: "bad json" }, "usdc.testnet"), "core.testnet")).toEqual({ invoice_id: null, method: "ft_transfer_call", kind: "other" });
    expect(transactionMetadata(outcome("accept_invoice", { id: "not-an-invoice" }), "core.testnet").invoice_id).toBeNull();
    expect(transactionMetadata({}, "core.testnet")).toEqual({ invoice_id: null, method: null, kind: "other" });
  });
  it("finds a lifecycle action after a non-invoice action", () => {
    const tx = outcome("storage_deposit", {});
    tx.transaction!.actions!.push(...outcome("accept_invoice", { id: "TW-0042" }).transaction!.actions!);
    expect(transactionMetadata(tx, "core.testnet")).toEqual({ invoice_id: "TW-0042", method: "accept_invoice", kind: "accept" });
  });
});
