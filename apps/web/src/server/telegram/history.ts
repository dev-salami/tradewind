import type { PoolHistoryPoint } from "@tradewind/core";
import { telegramStore } from "./store";
export function snapshotHistory(): PoolHistoryPoint[] {
  return telegramStore().db.prepare("SELECT ts, share_price_e6 FROM pool_snapshots ORDER BY block DESC LIMIT 1000").all().reverse().map(row => ({ at: String(row.ts), share_price_e6: String(row.share_price_e6), label: "Contract pool snapshot" }));
}
