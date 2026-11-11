import type { AdvancePreview, BuyerRecord, Config, Invoice, InvoiceStatus, Pool, PoolHistoryPoint } from "./types";
import { advanceRate, advanceTerms, applyWaterfall, buyerLimit, emptyPaid, sharePriceE6 } from "./math";
import { computeTermsHash, sha256Hex } from "./terms";
import { toUnits } from "./money";
export const SAMPLE_EXPORTER = "sample-cashew.testnet";
export const SAMPLE_BUYER = "gulf-foods-sample.testnet";
export const SAMPLE_EXPORTER_LABEL = "Sample Cashew Exports Ltd (sample)";
export const SAMPLE_BUYER_LABEL = "Gulf Foods Trading (sample)";
export const SAMPLE_NOW = "1794441600000000000";
export const fixtureConfig: Config = {
  usdc: "sample-usdc.testnet", seconds_per_day: 10, base_rate_bps: 7000, max_rate_bps: 8500,
  rate_step_bps: 100, pool_fee_bps_per_30d: 75, protocol_fee_bps: 50, grace_days: 7,
  default_after_days: 30, min_counted_face: "1000000", min_payment: "1000000", max_face: "50000000",
  base_buyer_limit: "10000000", limit_from_volume_bps: 5000, max_single_advance_bps: 5000,
  invoice_counter_start: 35, paused: false,
};
const dayNs = BigInt(fixtureConfig.seconds_per_day) * 1_000_000_000n;
const at = (days: number) => (BigInt(SAMPLE_NOW) + BigInt(days) * dayNs).toString();
const hash = (s: string) => sha256Hex(new TextEncoder().encode(s));
export function makeFixtures(stage: InvoiceStatus = "Funded") {
  function invoice(id: string, face: string, buyer: string, label: string, acceptedDay: number, rate: number, tenor = 60): Invoice {
    const terms = { exporter: SAMPLE_EXPORTER, buyer, invoice_number: id, face: toUnits(face).toString(), tenor_days: tenor, doc_hash: hash(`SAMPLE invoice ${id}`) };
    const t = advanceTerms(BigInt(terms.face), rate, tenor, fixtureConfig);
    return {
      ...terms, id, buyer_label: label, currency: "USDC", terms_hash: computeTermsHash(terms),
      created_at: at(acceptedDay - 2), accepted_at: at(acceptedDay), due_at: at(acceptedDay + tenor),
      verification: { verdict: "pass", model_id: "deepseek/deepseek-v3.2", request_hash: hash(`${id} sample request`), response_hash: hash(`${id} sample response`),
        signature: "0x7f3a00000000000000000000000000000000000000000000000000000000c21e", signing_address: "0x0000000000000000000000000000000000000000", signing_algo: "ecdsa", chat_id: `${id}-sample`, at: at(acceptedDay - 1) },
      status: "Funded", overdue: false,
      advance: { rate_bps: rate, amount: t.advance.toString(), pool_fee: t.pool_fee.toString(), protocol_fee: t.protocol_fee.toString(), at: at(acceptedDay) },
      paid: emptyPaid(), payments: [],
    };
  }
  function pay(i: Invoice, amount: bigint, when: string) {
    const result = applyWaterfall(i, amount);
    i.paid = result.paid; i.status = result.status;
    i.payments.push({ amount: amount.toString(), at: when, sender: i.buyer, payment_ref: `${i.id}-sample-part-${i.payments.length + 1}` });
  }
  const seeds = [35, 36, 37, 38].map((n, index) => {
    const i = invoice(`TW-00${n}`, "2", SAMPLE_BUYER, SAMPLE_BUYER_LABEL, -300 + index * 65, 7000 + index * 300);
    pay(i, BigInt(i.face), (BigInt(i.due_at!) + (index === 3 ? dayNs : 0n)).toString());
    return i;
  });
  const harbor = invoice("TW-0039", "2", "harbor-nuts-sample.testnet", "Harbor Nuts BV (sample)", -19, 7000);
  const main = invoice("TW-0042", "10", SAMPLE_BUYER, SAMPLE_BUYER_LABEL, 0, 8000);
  main.status = stage;
  if (["Created", "Verified", "Rejected", "Cancelled", "Accepted", "AdvancePending"].includes(stage)) main.advance = null;
  if (["Created", "Verified", "Rejected", "Cancelled"].includes(stage)) { main.accepted_at = null; main.due_at = null; }
  if (stage === "Created" || stage === "Cancelled") main.verification = null;
  if (stage === "Rejected" && main.verification) main.verification.verdict = "fail";
  if (stage === "PartiallyPaid" || stage === "Repaid") pay(main, toUnits("6"), at(20));
  if (stage === "Repaid") pay(main, toUnits("4"), at(40));
  if (stage === "Defaulted") main.overdue = true;
  const north = invoice("TW-0043", "1", "northgate-sample.testnet", "Northgate Traders (sample)", -40, 7000, 3);
  north.status = "Defaulted"; north.overdue = true;
  const invoices = [...seeds, harbor, main, north];
  const now = stage === "PartiallyPaid" ? at(20) : stage === "Repaid" ? at(40) : stage === "Defaulted" ? at(91) : SAMPLE_NOW;
  let idle = toUnits("20"), outstanding = 0n, writtenOff = 0n, fees = 0n, protocol = 0n;
  const shares = toUnits("20");
  const history: PoolHistoryPoint[] = [{ at: at(-305), label: "Seed", share_price_e6: sharePriceE6(idle, shares).toString() }];
  // Replay actual sample cash movements in chronological order, including write-offs.
  const events: { at: string; label: string; idle: bigint; principal: bigint; writtenOff: bigint; fee: bigint; protocol: bigint }[] = [];
  for (const i of invoices) {
    if (i.advance) events.push({ at: i.advance.at, label: `${i.id} advance`, idle: -BigInt(i.advance.amount), principal: BigInt(i.advance.amount), writtenOff: 0n, fee: 0n, protocol: 0n });
    let paid = emptyPaid();
    for (const payment of i.payments) {
      const result = applyWaterfall({ ...i, paid }, BigInt(payment.amount));
      paid = result.paid;
      const s = result.split;
      events.push({ at: payment.at, label: `${i.id} paid`, idle: BigInt(s.to_pool_principal) + BigInt(s.to_pool_fee), principal: -BigInt(s.to_pool_principal), writtenOff: 0n, fee: BigInt(s.to_pool_fee), protocol: BigInt(s.to_protocol) });
    }
    if (i.status === "Defaulted" && i.advance) {
      const unpaid = BigInt(i.advance.amount) - BigInt(i.paid.to_pool_principal);
      events.push({ at: (BigInt(i.due_at!) + BigInt(fixtureConfig.default_after_days + 1) * dayNs).toString(), label: `${i.id} default`, idle: 0n, principal: -unpaid, writtenOff: unpaid, fee: 0n, protocol: 0n });
    }
  }
  events.sort((a, b) => BigInt(a.at) < BigInt(b.at) ? -1 : BigInt(a.at) > BigInt(b.at) ? 1 : 0);
  for (const event of events) {
    idle += event.idle; outstanding += event.principal; writtenOff += event.writtenOff; fees += event.fee; protocol += event.protocol;
    history.push({ at: event.at, label: event.label, share_price_e6: sharePriceE6(idle + outstanding, shares).toString() });
  }
  const pool: Pool = { idle: idle.toString(), outstanding_principal: outstanding.toString(), written_off: writtenOff.toString(), total_assets: (idle + outstanding).toString(),
    total_shares: shares.toString(), share_price_e6: sharePriceE6(idle + outstanding, shares).toString(), fees_earned: fees.toString(), protocol_fees_paid: protocol.toString() };
  function buyerRecord(account: string): BuyerRecord | null {
    const rows = invoices.filter(i => i.buyer === account && i.accepted_at !== null);
    if (!rows.length) return null;
    let onTime = 0, grace = 0, late = 0, defaults = 0, volume = 0n, open = 0n;
    for (const i of rows) {
      if (i.status === "Repaid") {
        volume += BigInt(i.face);
        const delay = BigInt(i.payments.at(-1)!.at) - BigInt(i.due_at!);
        if (delay <= 0n) onTime++; else if (delay <= BigInt(fixtureConfig.grace_days) * dayNs) grace++; else late++;
      }
      if (i.status === "Defaulted") defaults++;
      if (i.advance) open += BigInt(i.advance.amount) - BigInt(i.paid.to_pool_principal);
    }
    const score = onTime * 3 + grace - late * 3 - defaults * 15;
    return { accepted: rows.length, repaid_on_time: onTime, repaid_grace: grace, repaid_late: late, defaulted: defaults, recovered: 0,
      repaid_volume: volume.toString(), open_principal: open.toString(), score, frozen: defaults > 0, last_update: now,
      rate_bps: advanceRate(score, defaults > 0, fixtureConfig), buyer_limit: buyerLimit(volume, fixtureConfig).toString() };
  }
  function preview(id: string): AdvancePreview {
    const i = invoices.find(row => row.id === id);
    if (!i) throw new Error("Invoice not found");
    const b = buyerRecord(i.buyer);
    const rate = i.advance?.rate_bps ?? advanceRate(b?.score ?? 0, b?.frozen ?? false, fixtureConfig);
    const terms = advanceTerms(BigInt(i.face), rate, i.tenor_days, fixtureConfig);
    let reason: string | null = null;
    if (i.status !== "Accepted") reason = "Invoice must be accepted and not already advanced";
    else if (fixtureConfig.paused) reason = "Protocol paused";
    else if (rate === 0) reason = "Buyer not eligible";
    else if (terms.exporter_rest < 0n) reason = "Fees exceed invoice remainder";
    else if (BigInt(b?.open_principal ?? "0") + terms.advance > BigInt(b?.buyer_limit ?? fixtureConfig.base_buyer_limit)) reason = "Buyer exposure limit";
    else if (terms.advance > BigInt(pool.idle)) reason = "Pool liquidity";
    else if (terms.advance > BigInt(pool.total_assets) * BigInt(fixtureConfig.max_single_advance_bps) / 10_000n) reason = "Single advance limit";
    return { rate_bps: rate, advance: (i.advance ? BigInt(i.advance.amount) : terms.advance).toString(), pool_fee: (i.advance ? BigInt(i.advance.pool_fee) : terms.pool_fee).toString(),
      protocol_fee: (i.advance ? BigInt(i.advance.protocol_fee) : terms.protocol_fee).toString(), exporter_rest: terms.exporter_rest.toString(), eligible: !reason, reason };
  }
  return { invoices, pool, history, buyerRecord, preview, config: { ...fixtureConfig }, now };
}
