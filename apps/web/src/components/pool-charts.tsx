"use client";
import { formatSharePrice, formatUsd, type Pool, type PoolHistoryPoint } from "@tradewind/core";
import { AreaLine, Donut, Segments } from "./charts";
export function PoolCharts({ pool, history }: { pool: Pool; history: PoolHistoryPoint[] }) {
  const assets = BigInt(pool.total_assets);
  // Only bounded ratios/chart coordinates become numbers, never monetary calculations.
  const idlePct = assets > 0n ? Number(BigInt(pool.idle) * 10_000n / assets) / 100 : 0;
  return <div className="tw-row-2"><section className="tw-card"><h2>Liquidity at work</h2><div className="tw-donut-wrap"><Donut segments={[
    { label: "Idle", value: idlePct, color: "#00C08B", hatch: "#00C08B" },
    { label: "Advanced", value: assets ? 100 - idlePct : 0, color: "#F5A524", hatch: "#F5A524" },
  ]} centerLabel="Total assets" centerValue={formatUsd(pool.total_assets)} />
    <dl className="tw-details"><div><dt>Idle liquidity</dt><dd className="tw-money">{formatUsd(pool.idle)}</dd></div><div><dt>In advances</dt><dd className="tw-money">{formatUsd(pool.outstanding_principal)}</dd></div></dl></div>
    <Segments value={idlePct} total={100} color="#00C08B" />
  </section><section className="tw-card"><h2>Share price · twPOOL</h2><p className="tw-muted">Principal returns preserve value. Pool fees grow it; defaults reduce it.</p>
    <AreaLine labels={history.map(p => p.label)} values={history.map(p => Number(p.share_price_e6))} format={v => formatSharePrice(BigInt(Math.max(0, Math.floor(v))))} />
  </section></div>;
}
