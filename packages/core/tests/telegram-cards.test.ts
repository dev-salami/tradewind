import { describe, expect, it } from "vitest";
import { advanceReady, approveState, buyerReminder, checkFailed, checked, defaulted, escapeHtml, lpSharePrice, makeFixtures, paymentReceived, repaid, type AdvancePreview } from "../src/index";
const base = "https://example.test";
const fixtures = makeFixtures("Accepted");
const invoice = { ...fixtures.invoices.find(i => i.id === "TW-0042")!, exporter: "sample-cashew.near", terms_hash: "9f2c000000a71b" };
const buyer = fixtures.buyerRecord(invoice.buyer)!;
const preview: AdvancePreview = { eligible: true, reason: null, rate_bps: 8000, advance: "8000000", pool_fee: "150000", protocol_fee: "50000", exporter_rest: "1800000" };
describe("Telegram cards", () => {
  it("matches the exact advance-ready spec copy", () => {
    expect(advanceReady(invoice, preview, { ...buyer, repaid_on_time: 3, repaid_grace: 1, repaid_late: 0, recovered: 0, score: 10 }, base, { approve: "approve", skip: "skip" })).toEqual({
      text: `<b>Tradewind</b> · advance ready · <code>TW-0042</code>

<b>🧾 Invoice</b>
$10.00 USDC · Gulf Foods Trading (sample) · Net 60

<b>📈 Advance rate</b>
80% · buyer record: 4 repaid (3 on time) · score 10

<b>💰 You receive now</b>
$8.00 USDC

<b>🧮 If the buyer pays on time</b>
Pool fee $0.15 · protocol fee $0.05 · you get $1.80 more

<blockquote><b>Will do:</b>
Send exactly $8.00 USDC from the Tradewind pool to sample-cashew.near. Terms 9f2c…a71b.</blockquote>`,
      buttons: [{ text: "✅ Approve advance", callback_data: "approve" }, { text: "✋ Not now", callback_data: "skip" }, { text: "🔎 Open invoice", url: `${base}/app/i/TW-0042` }],
    });
  });
  it("matches the exact repaid copy", () => {
    const i = makeFixtures("Repaid").invoices.find(i => i.id === "TW-0042")!;
    expect(repaid(i, 10, 13, 8300, base)).toEqual({ text: `<b>Tradewind</b> · 🎉 Repaid · <code>TW-0042</code>\n\nSplit: pool $8.15 · protocol $0.05 · you $1.80\nBuyer score 10 → 13 (next rate 83%)`, buttons: [{ text: "🧾 Receipt", url: `${base}/r/TW-0042` }] });
  });
  it("escapes every HTML metacharacter in buyer labels and reasons", () => {
    const label = `<script>alert("x")</script> & 'buyer'`;
    const card = advanceReady({ ...invoice, buyer_label: label }, preview, buyer, base);
    expect(card.text).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;buyer&#39;");
    expect(card.text).not.toContain("<script>");
    expect(checkFailed(invoice, [label], base).text).toContain(escapeHtml(label));
  });
  it("renders sent, terms-changed, skipped, and wallet fallback states", () => {
    expect(approveState(invoice, "skipped", base).text).toBe("Skipped. Advance stays available in the app.");
    expect(approveState(invoice, "sent", base, "tx<1", `${base}/tx`).text).toContain("💸 Sent");
    expect(approveState(invoice, "sent", base, "tx<1", `${base}/tx`).text).toContain("tx&lt;1");
    expect(advanceReady(invoice, preview, buyer, base, undefined, true).text).toContain("Terms changed, review again");
    expect(advanceReady(invoice, preview, buyer, base).buttons[0].url).toBe(`${base}/app/i/TW-0042?advance=1`);
  });
  it.each(["T-7", "T-1", "D0", "T+1", "T+7"] as const)("renders buyer %s reminder with wallet payment URLs", step => {
    const card = buyerReminder(invoice, step, base, "Sat 14 Nov", "60");
    expect(card.text).toContain("(contract day 60)");
    expect(card.buttons.map(b => b.url)).toEqual([`${base}/pay/TW-0042`, `${base}/pay/TW-0042?part=1`]);
  });
  it("renders other spec cards", () => {
    expect(checked(invoice, base).text).toContain("verdict pass");
    expect(defaulted(invoice, "1000000", base).text).toContain("pool wrote off $1.00");
    expect(lpSharePrice("1000000", "1007500", base).text).toContain("1.0000 → 1.0075");
    expect(paymentReceived(invoice, invoice.paid, "6000000", 1, 2, "Base", base).text).toContain("$6.00 of $10.00 via Base · Payment 1 of 2");
  });
});
