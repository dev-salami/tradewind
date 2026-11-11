// @vitest-environment node
import { expect, it, vi } from "vitest";
import { makeFixtures, type AdvancePreview } from "@tradewind/core";
import { openAutomationStore } from "@tradewind/core/automation-store";
import { handleCallback, makeApproveCard, type ApprovalDependencies } from "../src/server/telegram/callbacks";

it("changed-card issuance revokes all older approve/skip tokens and accepts only the fresh terms", async () => {
  const s = openAutomationStore(":memory:");
  try {
    const f = makeFixtures("Accepted");
    let invoice = f.invoices.find(i => i.id === "TW-0042")!;
    let preview: AdvancePreview = { advance: "8000000", rate_bps: 8000, pool_fee: "150000", protocol_fee: "50000", exporter_rest: "1800000", eligible: true, reason: null };
    s.consumeCode(s.issueCode(invoice.exporter, "exporter", true), "123", "123");
    const d: ApprovalDependencies = { invoice: async () => invoice, preview: async () => preview, buyer: async () => f.buyerRecord(invoice.buyer), approver: async () => "fixture-bot.testnet", send: vi.fn(async () => "fixture-tx"), botAccount: "fixture-bot.testnet", base: "http://localhost:3000", network: "sandbox" };
    const old = [await makeApproveCard(s, d, invoice), await makeApproveCard(s, d, invoice)];
    const other = s.issueCallback({ invoice_id: "OTHER", action: "approve", terms_hash: "other", amount_e6: "1", tg_user_id: "123" });
    invoice = { ...invoice, terms_hash: "changed-fixture-terms" };
    preview = { ...preview, advance: "7000000" };
    const fresh = await makeApproveCard(s, d, invoice, true);
    for (const c of old) for (const b of c.buttons.filter(b => b.callback_data)) {
      expect(s.callback(b.callback_data!)?.used_at).not.toBeNull();
      await expect(handleCallback(s, d, b.callback_data!, "123")).rejects.toThrow();
    }
    expect(s.callback(other)?.used_at).toBeNull();
    expect(d.send).not.toHaveBeenCalled();
    expect(fresh.text).toContain("Terms changed, review again");
    await handleCallback(s, d, fresh.buttons[0].callback_data!, "123");
    expect(d.send).toHaveBeenCalledExactlyOnceWith(invoice.id, invoice.terms_hash, "7000000");
  } finally { s.db.close(); }
});
