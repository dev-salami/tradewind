import { formatSharePrice, formatUsd } from "@tradewind/core";
import { data, isFixtureMode, network, nowNs } from "@/lib/data";
import { Card, Kpi, Pill } from "@/components/surfaces";
import { PoolCharts } from "@/components/pool-charts";
import { InvoiceTable } from "@/components/invoice-table";
import { PoolFlows } from "@/components/pool-flows";
export default async function PoolPage() {
  const source = data();
  const [pool, history, invoices, config] = await Promise.all([source.getPool(), source.poolHistory(), source.listInvoices(), source.getConfig()]);
  return <div className="tw-stack"><header className="tw-page-head"><div><p className="tw-eyebrow">Tradewind pool · twPOOL</p><h1>Capital that keeps trade moving.</h1><p className="tw-muted">{isFixtureMode() ? "Sample pool · read-only preview" : `On-chain pool · ${network()}`}</p></div><Pill value="Invitation-only MVP" /></header>
    <div className="tw-kpis"><Kpi value={formatUsd(pool.total_assets)} label="Total assets" dot="#00C08B" /><Kpi value={formatUsd(pool.written_off)} label="Written off" dot="#E5484D" /><Kpi value={formatSharePrice(pool.share_price_e6)} label="USDC per twPOOL" dot="#5B6B7F" /><Kpi value={formatUsd(pool.fees_earned)} label="Pool fees earned" dot="#00C08B" /></div>
    <PoolCharts pool={pool} history={history} />
    <div className="tw-row-2"><Card title="Your position"><PoolFlows /></Card><Card title="How the vault works"><p className="tw-muted">Assets = idle USDC + outstanding principal. Written-off principal is excluded. Redemptions are limited to idle liquidity.</p><dl className="tw-details"><div><dt>Shares issued</dt><dd>{formatUsd(pool.total_shares).replace("$", "")} twPOOL</dd></div><div><dt>Protocol fees paid</dt><dd>{formatUsd(pool.protocol_fees_paid)}</dd></div></dl></Card></div>
    <InvoiceTable title="Funded invoices & receipts" invoices={invoices.filter(i => i.advance !== null)} now={nowNs()} secondsPerDay={config.seconds_per_day} receipts />
  </div>;
}
