import { describe, expect, it } from "vitest";
import { parseEvents } from "../src/events";
const context = { tx_hash: "tx-base58", receipt_id: "receipt-base58", block_height: 450, block_timestamp: "1700000000000000000" };
describe("contract NEP-297 events", () => {
  it("parses real-shaped core logs without losing integer amounts or provenance", () => {
    const logs = [
      'EVENT_JSON:{"standard":"tradewind","version":"1.0.0","event":"invoice_created","data":[{"invoice_id":"TW-0042","invoice":{"face":"10000000","status":"Created"}}]}',
      'EVENT_JSON:{"standard":"tradewind","version":"1.0.0","event":"pool_deposit","data":[{"account_id":"lp.testnet","amount":"340282366920938463463374607431768211455","shares":"1000000"}]}',
      'EVENT_JSON:{"standard":"tradewind","version":"1.0.0","event":"waterfall_split","data":[{"invoice_id":"TW-0042","to_pool_principal":"7000000","to_pool_fee":"200000","to_protocol":"50000","to_exporter":"2750000","overpaid":"0"}]}',
    ];
    const events = parseEvents(logs, context);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ ...context, standard: "tradewind", version: "1.0.0", event: "invoice_created", idx: 0 });
    expect(events[1].data.amount).toBe("340282366920938463463374607431768211455");
    expect(events[2].data.to_pool_fee).toBe("200000");
  });
  it("ignores malformed/unrelated/unsupported logs and expands NEP-297 data arrays", () => {
    const logs = ["plain log", "EVENT_JSON:{", 'EVENT_JSON:{"standard":"nep141","version":"1.0.0","event":"ft_mint","data":[{}]}',
      'EVENT_JSON:{"standard":"tradewind","version":"2.0.0","event":"pool_deposit","data":[{}]}',
      'EVENT_JSON:{"standard":"tradewind","version":"1.0.0","event":"pool_deposit","data":[null,{"amount":"1"},{"amount":"2"}]}'];
    expect(parseEvents(logs, context).map(event => [event.idx, event.data.amount])).toEqual([[5, "1"], [6, "2"]]);
  });
});
