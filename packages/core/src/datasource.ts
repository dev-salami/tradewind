import type { AdvancePreview, BuyerRecord, Config, Invoice, InvoiceStatus, Pool, PoolHistoryPoint, StrayPayment } from "./types";
import { makeFixtures } from "./fixtures";
import { contractDay } from "./status";
import { sharesForDeposit, usdcForRedeem } from "./math";
import * as rpc from "./rpc";
export interface TradewindData {
  getInvoice(id: string): Promise<Invoice | null>;
  listInvoices(from?: number, limit?: number): Promise<Invoice[]>;
  invoicesByExporter(acct: string): Promise<Invoice[]>;
  invoicesByBuyer(acct: string): Promise<Invoice[]>;
  getBuyerRecord(acct: string): Promise<BuyerRecord | null>;
  previewAdvance(id: string): Promise<AdvancePreview>;
  getPool(): Promise<Pool>; getConfig(): Promise<Config>;
  previewDeposit(a: string): Promise<string>; previewRedeem(s: string): Promise<string>;
  getClaimable(acct: string): Promise<string>; listUnattributed(): Promise<StrayPayment[]>;
  isLpAllowed(acct: string): Promise<boolean>; nowContractDay(id: string): Promise<string | null>;
  poolHistory(): Promise<PoolHistoryPoint[]>;
}
export function fixtureData(options: { stage?: InvoiceStatus } = {}): TradewindData {
  const f = makeFixtures(options.stage);
  const copy = <T>(value: T): T => structuredClone(value);
  return {
    getInvoice: async id => copy(f.invoices.find(i => i.id === id) ?? null),
    listInvoices: async (from = 0, limit = 50) => copy(f.invoices.slice(from, from + limit)),
    invoicesByExporter: async acct => copy(f.invoices.filter(i => i.exporter === acct)),
    invoicesByBuyer: async acct => copy(f.invoices.filter(i => i.buyer === acct)),
    getBuyerRecord: async acct => copy(f.buyerRecord(acct)), previewAdvance: async id => copy(f.preview(id)),
    getPool: async () => copy(f.pool), getConfig: async () => copy(f.config),
    previewDeposit: async a => sharesForDeposit(BigInt(a), BigInt(f.pool.total_assets), BigInt(f.pool.total_shares)).toString(),
    previewRedeem: async s => usdcForRedeem(BigInt(s), BigInt(f.pool.total_assets), BigInt(f.pool.total_shares)).toString(),
    getClaimable: async () => "0", listUnattributed: async () => [], isLpAllowed: async acct => acct === "sample-lp.testnet",
    nowContractDay: async id => { const i = f.invoices.find(row => row.id === id); return i?.accepted_at ? contractDay(f.now, i.accepted_at, f.config.seconds_per_day).toString() : null; },
    poolHistory: async () => copy(f.history),
  };
}
export function rpcData({ rpcUrl: url, contractId: contract }: { rpcUrl: string; contractId: string }): TradewindData {
  return {
    getInvoice: id => rpc.getInvoice(url, contract, id), listInvoices: (from, limit) => rpc.listInvoices(url, contract, from, limit),
    invoicesByExporter: acct => rpc.invoicesByExporter(url, contract, acct), invoicesByBuyer: acct => rpc.invoicesByBuyer(url, contract, acct),
    getBuyerRecord: acct => rpc.getBuyerRecord(url, contract, acct), previewAdvance: id => rpc.previewAdvance(url, contract, id),
    getPool: () => rpc.getPool(url, contract), getConfig: () => rpc.getConfig(url, contract),
    previewDeposit: a => rpc.previewDeposit(url, contract, a), previewRedeem: s => rpc.previewRedeem(url, contract, s),
    getClaimable: acct => rpc.getClaimable(url, contract, acct), listUnattributed: () => rpc.listUnattributed(url, contract),
    isLpAllowed: acct => rpc.isLpAllowed(url, contract, acct), nowContractDay: id => rpc.nowContractDay(url, contract, id),
    // History needs the later event indexer. Do not fabricate historical RPC snapshots.
    poolHistory: async () => [],
  };
}
