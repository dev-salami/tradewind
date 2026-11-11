import { openAutomationStore } from "@tradewind/core/automation-store";
import { fixtureData, SAMPLE_NOW, type Config, type Invoice, type Pool } from "@tradewind/core";
import { approvalDependencies } from "../../web/src/server/telegram/dependencies";
import { view, signedCall } from "../../web/src/server/telegram/near";
import { flushNotifications } from "../../web/src/server/telegram/notify";
import { guidedCleanup, indexer, keeper, reminders, log, type JobDependencies } from "./jobs";
import { indexChain, indexerOptions } from "./chain-indexer";
import { relayerForward } from "./relayer";
// DATABASE_PATH should be absolute: npm workspace scripts have different working directories.
const s = openAutomationStore(process.env.DATABASE_PATH || "../web/data/tradewind.db");
const d: JobDependencies = { ...approvalDependencies(), list: from => view<Invoice[]>("list_invoices", { from_index: String(from), limit: 50 }), pool: () => view<Pool>("get_pool"), config: () => view<Config>("get_config"), keeper: (method, id) => signedCall("KEEPER", method, { id }), keeperConfigured: !!process.env.KEEPER_ACCOUNT_ID && !!process.env.KEEPER_PRIVATE_KEY };
const fixtures = (process.env.NEXT_PUBLIC_DATA_SOURCE || "fixtures") === "fixtures";
if (fixtures) {
  const source = fixtureData();
  Object.assign(d, { invoice: source.getInvoice, preview: source.previewAdvance, buyer: source.getBuyerRecord, approver: async () => null, list: (from: number) => source.listInvoices(from, 50), pool: source.getPool, config: source.getConfig, keeperConfigured: false, sample: true });
  log("worker", "fixtures_no_signing");
}
const interval = Number(process.env.WORKER_INTERVAL_MS || 5000);
if (!Number.isSafeInteger(interval) || interval < 100) throw new Error("Invalid WORKER_INTERVAL_MS");
let stopping = false;
process.on("SIGTERM", () => { stopping = true; }); process.on("SIGINT", () => { stopping = true; });
async function tick() {
  const now = fixtures ? SAMPLE_NOW : (BigInt(Date.now()) * 1_000_000n).toString();
  let invoices: Invoice[] = [], config: Config | undefined;
  try { const result = await indexer(s, d, now); invoices = result.invoices; config = result.config; } catch { log("indexer", "failed"); }
  // Keep jobs independent: a pool/indexer outage must not suppress keeper/reminder work.
  if (!config) try { config = await d.config(); invoices = (s.db.prepare("SELECT json_snapshot FROM invoices_cache").all()).map(r => JSON.parse(String(r.json_snapshot)) as Invoice); } catch { log("cache", "failed"); }
  if (config) {
    let protectedIds: Set<string> | undefined;
    try { protectedIds = await guidedCleanup(s, d, invoices); }
    catch (error) { log("guidedCleanup", "failed", { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" }); } // Fail closed for keeper, without suppressing independent notifications.
    if (protectedIds) {
      const excluded = protectedIds, safeInvoices = invoices.filter(i => !excluded.has(i.id));
      try { await keeper(s, d, safeInvoices, now, config); } catch { log("keeper", "failed"); }
    }
    try { reminders(s, d, invoices, now, config); } catch { log("reminders", "failed"); }
  }
  if (!fixtures) try { await relayerForward(s); } catch { log("relayer", "failed"); }
  try { await flushNotifications(s); } catch { log("notifier", "failed"); }
  // Chain backfill runs last so slow RPC scans never delay keeper, cleanup or notifications.
  if (!fixtures) try { log("chain_indexer", "complete", await indexChain(s.db, indexerOptions())); } catch (error) { log("chain_indexer", "failed", { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" }); }
}
async function main() {
  while (!stopping) { await tick(); if (!stopping) await new Promise(resolve => setTimeout(resolve, interval)); }
  s.db.close();
}
main().catch(() => { log("worker", "fatal"); process.exitCode = 1; });
