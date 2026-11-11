// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { fixtureData, makeFixtures } from "@tradewind/core";
import { Timeline, PaymentList, AiProof } from "../src/components/invoice-panels";
import { WorkerReceipts } from "../src/components/worker-receipts";
import { repository } from "../src/server/db";
import { withWorkerTransactions } from "../src/server/receipt-transactions";
import type { ReceiptTx } from "../src/lib/receipt-txs";

const mocks = vi.hoisted(() => ({ store: vi.fn() }));
vi.mock("../src/server/db", async original => ({ ...await original<typeof import("../src/server/db")>(), store: mocks.store }));
vi.mock("../src/lib/data", async () => {
  const env = await import("../src/lib/env-public");
  const { fixtureData } = await import("@tradewind/core");
  return { ...env, data: fixtureData };
});
const invoice = makeFixtures("Repaid").invoices.find(i => i.id === "TW-0042")!;
// Test-only hash inputs, never presented as live transactions.
const tx = (letter: string, kind: ReceiptTx["kind"]): ReceiptTx => ({ tx_hash: letter.repeat(44), method: null, kind });
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DATA_SOURCE", "rpc");
  vi.stubEnv("NEXT_PUBLIC_NEAR_NETWORK", "testnet");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in receipt tests"); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("public transaction links", () => {
  it("links only supplied hashes, leaves unknown steps unavailable, and uses the selected network", async () => {
    const html = renderToStaticMarkup(await Timeline({ invoice, txs: [tx("A", "create"), tx("B", "verify")] }));
    expect(html.match(/View tx ↗/g)).toHaveLength(2);
    expect(html).toContain(`https://testnet.nearblocks.io/txns/${"A".repeat(44)}`);
    expect(html).toContain(`https://testnet.nearblocks.io/txns/${"B".repeat(44)}`);
    expect(html).toContain("Transaction link unavailable");
    expect(renderToStaticMarkup(await Timeline({ invoice }))).not.toContain("/txns/");
    vi.stubEnv("NEXT_PUBLIC_NEAR_NETWORK", "mainnet");
    expect(renderToStaticMarkup(await Timeline({ invoice, txs: [tx("A", "accept")] }))).toContain(`https://nearblocks.io/txns/${"A".repeat(44)}`);
  });
  it("shows keeper overdue/default steps with their tx links once they happen", async () => {
    const defaulted = { ...invoice, status: "Defaulted" as const, overdue: true };
    const keeper = (letter: string, method: string): ReceiptTx => ({ tx_hash: letter.repeat(44), method, kind: "other" });
    const html = renderToStaticMarkup(await Timeline({ invoice: defaulted, txs: [keeper("C", "mark_overdue"), keeper("D", "mark_default")] }));
    expect(html).toContain("Overdue"); expect(html).toContain("Defaulted"); expect(html).not.toContain(">Repaid<");
    expect(html).toContain(`https://testnet.nearblocks.io/txns/${"C".repeat(44)}`);
    expect(html).toContain(`https://testnet.nearblocks.io/txns/${"D".repeat(44)}`);
    expect(renderToStaticMarkup(await Timeline({ invoice }))).not.toContain("Defaulted");
  });
  it("matches repayment parts by order without losing the progress bar or splits", async () => {
    const txs = [tx("A", "repay"), tx("B", "repay")];
    const html = renderToStaticMarkup(<PaymentList invoice={invoice} txs={txs} />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain("Part 1 tx (matched by order)");
    expect(html).toContain("Part 2 tx (matched by order)");
    expect(html.match(/\/txns\//g)).toHaveLength(2);
    const partial = renderToStaticMarkup(<PaymentList invoice={invoice} txs={txs.slice(0, 1)} />);
    expect(partial).not.toContain("Part 2 tx");
    expect(partial).toContain("Part 2");
    const timeline = renderToStaticMarkup(await Timeline({ invoice, txs }));
    expect(timeline.match(/View tx ↗/g)).toHaveLength(3); // Both parts and the final Repaid step.
  });
  it("suppresses all tx links in fixture mode even if hashes are accidentally supplied", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_SOURCE", "fixtures");
    const txs = [tx("A", "create"), tx("B", "repay")];
    expect(renderToStaticMarkup(await Timeline({ invoice, txs }))).not.toContain("/txns/");
    expect(renderToStaticMarkup(<PaymentList invoice={invoice} txs={txs} />)).not.toContain("/txns/");
    expect(renderToStaticMarkup(<WorkerReceipts id={invoice.id} txs={txs} />)).toBe("");
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("merges worker receipts once, preserves kind labels and reminders, and links Telegram advances", async () => {
    const repo = repository(":memory:"); mocks.store.mockReturnValue(repo);
    try {
      repo.putTx("A".repeat(44), "sample.testnet", invoice.id, "create_invoice", "create");
      repo.db.prepare("INSERT INTO automation_receipts VALUES (?, ?, ?)").run(invoice.id, "A".repeat(44), "wallet tx notify");
      repo.db.prepare("INSERT INTO automation_receipts VALUES (?, ?, ?)").run(invoice.id, "B".repeat(44), "Telegram advance approval");
      repo.db.prepare("INSERT INTO reminders (invoice_id, step, channel, sent_at) VALUES (?, ?, ?, ?)").run(invoice.id, "T-1", "log", 1);
      const txs = withWorkerTransactions(invoice.id, repo.txsForInvoice(invoice.id));
      expect(txs).toHaveLength(2);
      const html = renderToStaticMarkup(<WorkerReceipts id={invoice.id} txs={txs} />);
      expect(html.match(/\/txns\//g)).toHaveLength(2);
      expect(html).toContain("Transactions"); expect(html).toContain("create"); expect(html).toContain("advance");
      expect(html).toContain("T-1"); expect(html).toContain("log");
      expect(renderToStaticMarkup(await Timeline({ invoice, txs }))).toContain(`https://testnet.nearblocks.io/txns/${"B".repeat(44)}`);
    } finally { repo.db.close(); }
  });
  it("keeps the public AI proof Verify control", async () => {
    const sample = await fixtureData().getInvoice(invoice.id);
    expect(renderToStaticMarkup(<AiProof invoice={sample!} sample verify />)).toContain(">Verify</button>");
  });
});
