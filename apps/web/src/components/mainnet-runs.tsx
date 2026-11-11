export interface MainnetRunStats { runs: number; invoices: number; volume_usdc: number }
function parseStats(json: string): MainnetRunStats | null {
  try {
    const value = JSON.parse(json);
    if (!value || ![value.runs, value.invoices].every(n => Number.isSafeInteger(n) && n >= 0) || typeof value.volume_usdc !== "number" || !Number.isFinite(value.volume_usdc) || value.volume_usdc < 0) return null;
    return value;
  } catch { return null; }
}
/** JSON contract: { runs, invoices, volume_usdc }. Missing/invalid data stays silent. */
export function MainnetRuns({ json = process.env.NEXT_PUBLIC_MAINNET_RUNS_JSON || "" }: { json?: string }) {
  const stats = parseStats(json);
  if (!stats) return null;
  return <section className="tw-mainnet-stats" aria-label="Mainnet runs"><h2>Mainnet runs</h2><dl><div><dt>Completed runs</dt><dd>{stats.runs.toLocaleString("en-US")}</dd></div><div><dt>Invoices</dt><dd>{stats.invoices.toLocaleString("en-US")}</dd></div><div><dt>Volume · USDC</dt><dd>{stats.volume_usdc.toLocaleString("en-US", { maximumFractionDigits: 2 })}</dd></div></dl></section>;
}
