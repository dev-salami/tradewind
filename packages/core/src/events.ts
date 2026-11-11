/** NEP-297 events emitted by contracts/tradewind/src/events.rs. */
export const CHAIN_EVENT_NAMES = ["invoice_created", "invoice_verified", "invoice_rejected", "invoice_accepted", "invoice_cancelled", "advance_paid", "advance_reverted", "invoice_overdue", "invoice_defaulted", "invoice_repaid", "pool_deposit", "pool_redeem", "pool_redeem_reverted", "payment_received", "waterfall_split", "unattributed_payment", "buyer_record_updated", "approver_updated", "admin_action"] as const;
export type ChainEventName = typeof CHAIN_EVENT_NAMES[number];
export interface EventContext { tx_hash: string; receipt_id: string; block_height: number; block_timestamp: string }
export interface ChainEvent extends EventContext { standard: "tradewind"; version: "1.0.0"; event: ChainEventName; data: Record<string, unknown> }
/** idx is a stable flattened log/data ordinal, including unrelated log positions. */
export function parseEvents(logs: readonly string[], context: EventContext): (ChainEvent & { idx: number })[] {
  const events: (ChainEvent & { idx: number })[] = [];
  let idx = 0;
  for (const log of logs) {
    let value;
    try { value = log.startsWith("EVENT_JSON:") ? JSON.parse(log.slice(11)) : null; } catch { value = null; }
    if (value?.standard !== "tradewind" || value.version !== "1.0.0" || !CHAIN_EVENT_NAMES.includes(value.event) || !Array.isArray(value.data)) { idx++; continue; }
    for (const data of value.data) {
      if (data && typeof data === "object" && !Array.isArray(data)) events.push({ ...context, standard: "tradewind", version: "1.0.0", event: value.event, data, idx });
      idx++;
    }
  }
  return events;
}
