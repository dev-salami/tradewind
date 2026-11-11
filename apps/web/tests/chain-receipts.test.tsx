// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveReceiptTransactions } from "../src/server/receipt-transactions";
import { EVENT_RECEIPT_LABELS } from "../src/lib/receipt-txs";
import { receiptExplorer } from "../src/lib/tx";
import { WorkerReceipts } from "../src/components/worker-receipts";
import { repository } from "../src/server/db";
const mocks = vi.hoisted(() => ({ store: vi.fn() }));
vi.mock("../src/server/db", async original => ({ ...await original<typeof import("../src/server/db")>(), store: mocks.store }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it.each(["testnet", "mainnet", "sandbox"] as const)("reconstructs public receipt links after legacy data loss on %s", net => {
  const repo = repository(":memory:"); mocks.store.mockReturnValue(repo);
  vi.stubEnv("NEXT_PUBLIC_DATA_SOURCE", "rpc"); vi.stubEnv("NEXT_PUBLIC_NEAR_NETWORK", net);
  try {
    repo.db.exec("CREATE TABLE chain_events (block_height INTEGER, tx_hash TEXT, receipt_id TEXT, idx INTEGER, event TEXT, invoice_id TEXT)");
    for (const [idx, event] of Object.keys(EVENT_RECEIPT_LABELS).entries()) repo.db.prepare("INSERT INTO chain_events VALUES (?, ?, ?, ?, ?, ?)").run(20 + idx, `hash${idx}`, `receipt${idx}`, idx, event, "TW-0042");
    const txs = resolveReceiptTransactions(repo.db, "TW-0042", [], net);
    expect(txs).toHaveLength(8);
    expect(txs.map(tx => tx.detail?.split(" · ")[0])).toEqual(["created", "verified", "accepted", "funded", "payment", "repaid", "defaulted", "cancelled"]);
    const html = renderToStaticMarkup(<WorkerReceipts id="TW-0042" txs={txs} />);
    expect(html).toContain("hash0");
    if (net === "sandbox") { expect(html).not.toContain("nearblocks.io"); expect(html).toContain("local sandbox"); expect(receiptExplorer(net, "hash0").url).toBeNull(); }
    else expect(html).toContain(`https://${net === "testnet" ? "testnet." : ""}nearblocks.io/txns/hash0`);
  } finally { repo.db.close(); }
});
it("falls back on old receipts and merges multiple event labels for one transaction", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE automation_receipts (invoice_id TEXT, tx_hash TEXT, detail TEXT); INSERT INTO automation_receipts VALUES ('TW-0042','hash','Telegram advance approval')");
    expect(resolveReceiptTransactions(db, "TW-0042", [], "testnet")[0].kind).toBe("advance");
    db.exec("CREATE TABLE chain_events (block_height INTEGER, tx_hash TEXT, receipt_id TEXT, idx INTEGER, event TEXT, invoice_id TEXT); INSERT INTO chain_events VALUES (20,'hash','r',0,'payment_received','TW-0042'), (20,'hash','r',1,'invoice_repaid','TW-0042')");
    const txs = resolveReceiptTransactions(db, "TW-0042", [], "testnet");
    expect(txs).toHaveLength(1); expect(txs[0]).toMatchObject({ kind: "repay", detail: "payment · repaid" });
    expect(resolveReceiptTransactions(db, "other", [], "testnet")).toEqual([]);
  } finally { db.close(); }
});
