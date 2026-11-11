import { describe, expect, it } from "vitest";
import { invoicesCsv, paymentsCsv } from "../src/index";
import { makeFixtures } from "../src/fixtures";
import { emptyPaid } from "../src/math";

const invoiceHeader = "id,invoice_number,exporter,buyer,buyer_label,face_usdc,currency,tenor_days,status,created_at,accepted_at,due_at,advance_rate_pct,advance_usdc,pool_fee_usdc,protocol_fee_usdc,paid_total_usdc\r\n";
const paymentHeader = "invoice_id,part,payer,payment_ref,at,amount_usdc,to_pool_principal,to_pool_fee,to_protocol,to_exporter\r\n";
const invoice = () => makeFixtures("Repaid").invoices.find(i => i.id === "TW-0042")!;

describe("accounting CSV", () => {
  it("returns exactly the ordered header and CRLF for empty lists", () => {
    expect(invoicesCsv([])).toBe(invoiceHeader);
    expect(paymentsCsv([])).toBe(paymentHeader);
    expect(paymentsCsv([{ ...invoice(), payments: [] }])).toBe(paymentHeader);
  });
  it("quotes commas, doubles quotes and retains embedded CR/LF and Unicode", () => {
    const i = { ...invoice(), invoice_number: 'INV,"42"', buyer_label: 'Trade, "食品"\r\nTrading' };
    expect(invoicesCsv([i])).toContain('TW-0042,"INV,""42""",');
    expect(invoicesCsv([i])).toContain(',"Trade, ""食品""\r\nTrading",10.000000,');
    i.payments[0].payment_ref = 'ref,"quoted"\nnext';
    expect(paymentsCsv([i])).toContain(',"ref,""quoted""\nnext",');
  });
  it.each(["=SUM(1,2)", "+1", "-1", "@SUM(A1)", "\tformula", "\rformula"])("neutralises leading spreadsheet syntax %j", value => {
    const i = { ...invoice(), invoice_number: value, buyer_label: value };
    const safe = `'${value}`;
    const encoded = /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    expect(invoicesCsv([i])).toContain(`,${encoded},`);
    i.payments[0] = { ...i.payments[0], sender: value, payment_ref: value };
    expect(paymentsCsv([i])).toContain(`,${encoded},${encoded},`);
  });
  it("exports base-unit amounts above Number precision with exactly six decimals", () => {
    const i = invoice();
    i.face = "340282366920938463463374607431768211455";
    i.advance = { rate_bps: 8123, amount: "9007199254740993", pool_fee: "1", protocol_fee: "1000000", at: "0" };
    i.paid.total = "9007199254740993";
    const cells = invoicesCsv([i]).split("\r\n")[1].split(",");
    expect(cells[5]).toBe("340282366920938463463374607431768.211455");
    expect(cells.slice(12)).toEqual(["81.23", "9007199254.740993", "0.000001", "1.000000", "9007199254.740993"]);
    i.payments = [{ amount: "9007199254740993", at: "0", sender: i.buyer, payment_ref: "exact" }];
    expect(paymentsCsv([i])).toContain(",9007199254.740993,9007199254.740993,0.000000,0.000000,0.000000\r\n");
  });
  it("uses UTC timestamps from ns and leaves null dates/rates blank", () => {
    const i = { ...invoice(), created_at: "1794355200123456789", accepted_at: null, due_at: null, advance: null, paid: emptyPaid() };
    expect(invoicesCsv([i])).toContain(",2026-11-11T00:00:00.123456789Z,,,,0.000000,0.000000,0.000000,0.000000\r\n");
    i.created_at = "0";
    expect(invoicesCsv([i])).toContain(",1970-01-01T00:00:00.000Z,");
  });
  it("replays each payment waterfall with one-based parts, without mutation", () => {
    const i = invoice(), before = structuredClone(i);
    const rows = paymentsCsv([i]).split("\r\n").slice(1, -1).map(r => r.split(","));
    expect(rows.map(r => r.slice(0, 4))).toEqual([
      [i.id, "1", i.buyer, "TW-0042-sample-part-1"],
      [i.id, "2", i.buyer, "TW-0042-sample-part-2"],
    ]);
    expect(rows.map(r => r.slice(5))).toEqual([
      ["6.000000", "6.000000", "0.000000", "0.000000", "0.000000"],
      ["4.000000", "2.000000", "0.150000", "0.050000", "1.800000"],
    ]);
    expect(rows[0][4]).toBe(new Date(Number(BigInt(i.payments[0].at) / 1_000_000n)).toISOString());
    invoicesCsv([i]);
    expect(i).toEqual(before);
  });
  it("allocates unadvanced payments to the exporter and resets parts per invoice", () => {
    const i = { ...invoice(), advance: null };
    const rows = paymentsCsv([i, i]).split("\r\n").slice(1, -1).map(r => r.split(","));
    expect(rows.map(r => r[1])).toEqual(["1", "2", "1", "2"]);
    expect(rows[0].slice(5)).toEqual(["6.000000", "0.000000", "0.000000", "0.000000", "6.000000"]);
  });
});
