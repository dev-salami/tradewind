import { parseAmount } from "./tx";

export const GUIDED_STORAGE_KEY = "tw:guided:invoice";
export const GUIDED_STEPS = ["invoice", "accept", "advance", "pay"] as const;
export type GuidedStep = typeof GUIDED_STEPS[number];
export interface GuidedResult {
  step: GuidedStep;
  invoice_id?: string;
  tx_links: string[];
  verdict?: string;
  mock?: boolean;
  error?: string;
}
export interface GuidedProgress {
  invoice_id?: string;
  next: number;
  paused: boolean;
  results: GuidedResult[];
}
export const emptyGuidedProgress = (): GuidedProgress => ({ next: 0, paused: false, results: [] });
export const guidedUnits = (usd: string): string => parseAmount(usd);
export function guidedStepEnabled(progress: GuidedProgress, step: GuidedStep, busy: boolean): boolean {
  return !busy && !progress.paused && GUIDED_STEPS[progress.next] === step && (step === "invoice" || !!progress.invoice_id);
}
export function guidedAvailable(network: string, status: number, body: { available?: unknown }): boolean {
  return network !== "mainnet" && status >= 200 && status < 300 && body.available === true;
}
export function testnetTxLinks(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((link): link is string => typeof link === "string" && /^https:\/\/testnet\.nearblocks\.io\/txns\/[^/?#]+$/.test(link)) : [];
}
export function resumeGuided(storage: Pick<Storage, "getItem">): GuidedProgress {
  try {
    const raw = storage.getItem(GUIDED_STORAGE_KEY);
    if (!raw) return emptyGuidedProgress();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return emptyGuidedProgress();
    const p = value as Partial<GuidedProgress>;
    if (!Number.isInteger(p.next) || p.next === undefined || p.next < 0 || p.next > 4 || typeof p.paused !== "boolean" || !Array.isArray(p.results)) return emptyGuidedProgress();
    if (p.invoice_id !== undefined && (typeof p.invoice_id !== "string" || !/^TW-\d{4,20}$/.test(p.invoice_id))) return emptyGuidedProgress();
    if (p.next > 0 && !p.invoice_id) return emptyGuidedProgress();
    if (p.results.some(r => !r || !GUIDED_STEPS.includes(r.step) || !Array.isArray(r.tx_links) || (r.error !== undefined && typeof r.error !== "string") || (r.verdict !== undefined && typeof r.verdict !== "string"))) return emptyGuidedProgress();
    return { invoice_id: p.invoice_id, next: p.next, paused: p.paused, results: p.results.map(r => ({ ...r, tx_links: testnetTxLinks(r.tx_links) })) };
  } catch { return emptyGuidedProgress(); }
}
