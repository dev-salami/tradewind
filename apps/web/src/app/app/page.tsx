import Link from "next/link";
import { ArrowDownLeft, Wallet, TrendingUp, Plus } from "lucide-react";
import { formatUsd, fixtureData, SAMPLE_EXPORTER, SAMPLE_NOW } from "@tradewind/core";
import { Avatar, Card, Kpi, Pill } from "@/components/surfaces";
import { InvoiceTable } from "@/components/invoice-table";
import { ExporterDashboard } from "@/components/exporter-dashboard";
import { ExportLinks } from "@/components/export-links";
export default async function Dashboard() {
  const source = fixtureData();
  // Account selection follows wallet wiring. Never claim the sample account is connected.
  const [invoices, config] = await Promise.all([source.invoicesByExporter(SAMPLE_EXPORTER), source.getConfig()]);
  const due = invoices.reduce((sum, i) => sum + BigInt(i.face) - BigInt(i.paid.total) + BigInt(i.paid.overpaid), 0n);
  const advanced = invoices.reduce((sum, i) => sum + BigInt(i.advance?.amount ?? "0"), 0n);
  return <ExporterDashboard sample={<div className="tw-stack"><header className="tw-page-head"><div><p className="tw-eyebrow">Exporter demo</p><h1>Sample exporter workspace</h1><p className="tw-muted">Your trade, moving forward.</p></div><Avatar name="Sample exporter" size={48} /></header>
    <div className="tw-toolbar"><Pill value="Telegram not linked" /><Link href="/app/new" className="tw-button"><Plus size={16} />New invoice</Link></div>
    <ExportLinks accountId={SAMPLE_EXPORTER} />
    <div className="tw-kpis tw-kpis-3"><Kpi icon={<ArrowDownLeft size={19} />} value={<span className="tw-amber">{formatUsd(due)}</span>} label="Cash due · invoice balances" /><Kpi icon={<Wallet size={19} />} value="—" label="Cash on hand · connect wallet" /><Kpi icon={<TrendingUp size={19} />} value={formatUsd(advanced)} label="Advanced to date" /></div>
    <InvoiceTable invoices={invoices} now={SAMPLE_NOW} secondsPerDay={config.seconds_per_day} />
    <div className="tw-row-2"><Card title="A better way to wait"><p className="tw-muted">Turn accepted invoices into working capital. Rates follow the buyer’s on-chain repayment record.</p><Link href="/pool" className="tw-text-link">Explore the pool ↗</Link></Card><Card title="Read-only foundation"><p className="tw-muted">Wallet balances, Telegram linking and invoice creation become available after wallet connect. No funds can move from this preview.</p><div className="tw-hatch" aria-hidden="true" /></Card></div>
  </div>} />;
}
