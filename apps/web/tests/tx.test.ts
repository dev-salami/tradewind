import { describe, expect, it } from "vitest";
import * as tx from "../src/lib/tx";
const core = "core.testnet", usdc = "usdc.testnet", id = "TW-0042";
const create = { buyer: "buyer.testnet", buyer_label: "Buyer", invoice_number: "INV-1", face: "10000000", tenor_days: 60, doc_hash: "a".repeat(64), terms_hash: "b".repeat(64) };
describe("wallet calls match the Rust ABI (base units, gas, deposits)", () => {
  it.each([
    ["create", tx.createInvoiceTx(core, create), core, "create_invoice", create, "50000000000000000000000", "30000000000000"],
    ["accept", tx.acceptInvoiceTx(core, id, "hash"), core, "accept_invoice", { id, terms_hash: "hash" }, "1", "30000000000000"],
    ["advance", tx.requestAdvanceTx(core, id, "hash", "8000000"), core, "request_advance", { id, expected_terms_hash: "hash", min_advance: "8000000" }, "0", "100000000000000"],
    ["approver", tx.setApproverTx(core, "bot.testnet"), core, "set_approver", { approver: "bot.testnet" }, "1", "30000000000000"],
    ["revoke", tx.setApproverTx(core, null), core, "set_approver", { approver: null }, "1", "30000000000000"],
    ["deposit", tx.depositTx(usdc, core, "1000000"), usdc, "ft_transfer_call", { receiver_id: core, amount: "1000000", msg: '{"action":"deposit"}' }, "1", "150000000000000"],
    ["redeem", tx.redeemTx(core, "1234567"), core, "redeem", { shares: "1234567" }, "1", "100000000000000"],
    ["claim", tx.claimTx(core), core, "claim", {}, "1", "100000000000000"],
    ["direct", tx.repayDirectTx(usdc, core, id, "1000000", "random"), usdc, "ft_transfer_call", { receiver_id: core, amount: "1000000", msg: '{"action":"repay","invoice_id":"TW-0042","payment_ref":"direct:random"}' }, "1", "150000000000000"],
    ["storage", tx.usdcStorageDepositTx(usdc, "exporter.testnet", "1250000000000000000000"), usdc, "storage_deposit", { account_id: "exporter.testnet", registration_only: true }, "1250000000000000000000", "30000000000000"],
    ["cancel", tx.cancelInvoiceTx(core, id), core, "cancel_invoice", { id }, "0", "30000000000000"],
    ["pause", tx.pauseTx(core), core, "pause", {}, "1", "30000000000000"],
    ["unpause", tx.unpauseTx(core), core, "unpause", {}, "1", "30000000000000"],
    ["allow", tx.lpAllowTx(core, "lp.testnet", true), core, "lp_allow", { account_id: "lp.testnet", allowed: true }, "1", "30000000000000"],
    ["remove", tx.lpAllowTx(core, "lp.testnet", false), core, "lp_allow", { account_id: "lp.testnet", allowed: false }, "1", "30000000000000"],
    ["unfreeze", tx.unfreezeBuyerTx(core, "buyer.testnet"), core, "unfreeze_buyer", { account_id: "buyer.testnet" }, "1", "30000000000000"],
    ["attribute", tx.attributeUnattributedTx(core, "0", id), core, "attribute_unattributed", { index: "0", invoice_id: id }, "1", "100000000000000"],
    ["refund stray", tx.refundUnattributedTx(core, "1", "buyer.testnet"), core, "refund_unattributed", { index: "1", to: "buyer.testnet" }, "1", "100000000000000"],
    ["refund excess", tx.refundOverpaidTx(core, id, "buyer.testnet", "100"), core, "refund_overpaid", { id, to: "buyer.testnet", amount: "100" }, "1", "100000000000000"],
    ["overdue", tx.markOverdueTx(core, id), core, "mark_overdue", { id }, "0", "30000000000000"],
    ["default", tx.markDefaultTx(core, id), core, "mark_default", { id }, "0", "30000000000000"],
  ])("%s", (_name, built, receiverId, methodName, args, deposit, gas) => {
    expect(built).toEqual({ receiverId, actions: [{ type: "FunctionCall", params: { methodName, args, deposit, gas } }] });
    expect(JSON.parse(JSON.stringify(built))).toEqual(built);
  });
  it("refuses an unconfigured receiver", () => expect(() => tx.claimTx("")).toThrow(/configured/));
  it("uses distinct repayment references by default", () => {
    const first = tx.repayDirectTx(usdc, core, id, "100").actions[0].params.args.msg;
    const second = tx.repayDirectTx(usdc, core, id, "100").actions[0].params.args.msg;
    expect(first).not.toBe(second);
  });
});
describe("strict six-decimal amount parsing", () => {
  it.each(["0", "0.000000", "-1", "1.0000001", "1e6", "NaN", "Infinity", "", " 1", ".1", "1.", "1,000", "340282366920938463463374607431768211456"])("rejects %s", value => expect(() => tx.parseAmount(value)).toThrow());
  it.each([["1", "1000000"], ["0.000001", "1"], ["10.123456", "10123456"], ["0001.2", "1200000"]])("%s → %s", (value, units) => expect(tx.parseAmount(value)).toBe(units));
});
