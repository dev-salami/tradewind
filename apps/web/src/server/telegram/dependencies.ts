import type { AdvancePreview, BuyerRecord, Invoice } from "@tradewind/core";
import type { ApprovalDependencies } from "./callbacks";
import { botCall, view } from "./near";
export function approvalDependencies(): ApprovalDependencies {
  const network = process.env.NEAR_NETWORK || "testnet";
  if (!["testnet", "mainnet", "sandbox"].includes(network)) throw new Error("Invalid network");
  return { invoice: id => view<Invoice | null>("get_invoice", { id }), preview: id => view<AdvancePreview>("preview_advance", { id }), buyer: account_id => view<BuyerRecord | null>("get_buyer_record", { account_id }), approver: exporter => view<string | null>("get_approver", { exporter }), send: botCall, botAccount: process.env.BOT_ACCOUNT_ID || "", base: process.env.PUBLIC_BASE_URL || "http://localhost:3000", network: network as ApprovalDependencies["network"] };
}
