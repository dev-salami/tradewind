/** Wallet-selector FunctionCall actions. Amounts are integer base units, never floats. */
import { explorerTx, type NearNetwork } from "@tradewind/core";
export function receiptExplorer(network: NearNetwork, hash: string) {
  return { hash, url: explorerTx(network, hash), label: network === "sandbox" ? "local sandbox" : "NearBlocks" };
}
export interface ContractTx { receiverId: string; actions: { type: "FunctionCall"; params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string } }[] }
export const GAS = { call: "30000000000000", payout: "100000000000000", transfer: "150000000000000" } as const;
export const CREATE_DEPOSIT = "50000000000000000000000";
function call(receiverId: string, methodName: string, args: Record<string, unknown> = {}, deposit = "0", gas: string = GAS.call): ContractTx {
  if (!receiverId) throw new Error("Contract account is not configured");
  return { receiverId, actions: [{ type: "FunctionCall", params: { methodName, args, gas, deposit } }] };
}
export interface CreateInvoiceArgs { buyer: string; buyer_label: string; invoice_number: string; face: string; tenor_days: number; doc_hash: string; terms_hash: string | null }
export const createInvoiceTx = (core: string, args: CreateInvoiceArgs) => call(core, "create_invoice", { ...args }, CREATE_DEPOSIT);
export const acceptInvoiceTx = (core: string, id: string, terms_hash: string) => call(core, "accept_invoice", { id, terms_hash }, "1");
export const requestAdvanceTx = (core: string, id: string, expected_terms_hash: string, min_advance: string) => call(core, "request_advance", { id, expected_terms_hash, min_advance }, "0", GAS.payout);
export const setApproverTx = (core: string, approver: string | null) => call(core, "set_approver", { approver }, "1");
export const depositTx = (usdc: string, core: string, amount: string) => call(usdc, "ft_transfer_call", { receiver_id: core, amount, msg: JSON.stringify({ action: "deposit" }) }, "1", GAS.transfer);
export const redeemTx = (core: string, shares: string) => call(core, "redeem", { shares }, "1", GAS.payout);
export const claimTx = (core: string) => call(core, "claim", {}, "1", GAS.payout);
export const repayDirectTx = (usdc: string, core: string, invoice_id: string, amount: string, random = crypto.randomUUID()) => call(usdc, "ft_transfer_call", { receiver_id: core, amount, msg: JSON.stringify({ action: "repay", invoice_id, payment_ref: `direct:${random}` }) }, "1", GAS.transfer);
export const usdcStorageDepositTx = (usdc: string, account_id: string, min: string) => call(usdc, "storage_deposit", { account_id, registration_only: true }, min);
export const cancelInvoiceTx = (core: string, id: string) => call(core, "cancel_invoice", { id });
export const pauseTx = (core: string) => call(core, "pause", {}, "1");
export const unpauseTx = (core: string) => call(core, "unpause", {}, "1");
export const lpAllowTx = (core: string, account_id: string, allowed: boolean) => call(core, "lp_allow", { account_id, allowed }, "1");
export const unfreezeBuyerTx = (core: string, account_id: string) => call(core, "unfreeze_buyer", { account_id }, "1");
export const attributeUnattributedTx = (core: string, index: string, invoice_id: string) => call(core, "attribute_unattributed", { index, invoice_id }, "1", GAS.payout);
export const refundUnattributedTx = (core: string, index: string, to: string) => call(core, "refund_unattributed", { index, to }, "1", GAS.payout);
export const refundOverpaidTx = (core: string, id: string, to: string, amount: string) => call(core, "refund_overpaid", { id, to, amount }, "1", GAS.payout);
export const markOverdueTx = (core: string, id: string) => call(core, "mark_overdue", { id });
export const markDefaultTx = (core: string, id: string) => call(core, "mark_default", { id });

export function parseAmount(value: string): string {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) throw new Error("Enter a positive amount with at most 6 decimal places");
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  if (units <= 0n || units > 2n ** 128n - 1n) throw new Error("Amount out of range");
  return units.toString();
}
