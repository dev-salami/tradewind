"use client";
import Link from "next/link";
import { useState } from "react";
import { formatUsd, type Invoice, type Config } from "@tradewind/core";
import { useWallet } from "./wallet-provider";
import { ReadState, useView } from "./write-controls";
import { InvoiceTable } from "./invoice-table";
import { Kpi } from "./surfaces";
import { usdcId } from "@/lib/near";
import { ExportLinks } from "./export-links";
import { Card, Pill } from "./surfaces";
import { isFixtureMode } from "@/lib/env-public";
export function ExporterDashboard({ sample }: { sample?: React.ReactNode }) {
  const { accountId, connect } = useWallet();
  const [demo, setDemo] = useState(false), [error, setError] = useState("");
  if (demo || (accountId && isFixtureMode())) return <div className="tw-stack"><div className="tw-toolbar"><Pill value="Sample data" tone="amber" /><p>Illustrative only · no real transactions or wallet balances</p><button className="tw-ghost" onClick={() => setDemo(false)} disabled={!!accountId && isFixtureMode()}>Exit sample data</button></div>{sample}</div>;
  if (!accountId) return <Card title="Welcome to Tradewind"><div className="tw-stack"><p className="tw-muted">Your invoices and working capital, in one place. Connect your wallet to get started, or take a look around with sample data.</p><div className="tw-toolbar"><button className="tw-button" onClick={async () => { try { await connect(); } catch { setError("Could not connect. Please try again."); } }}>Connect wallet</button><button className="tw-ghost" onClick={() => setDemo(true)}>Explore the demo (sample data)</button></div>{error && <p role="alert">{error}</p>}</div></Card>;
  return <WalletDashboard key={accountId} accountId={accountId} />;
}
function WalletDashboard({ accountId }: { accountId: string }) {
  const [now] = useState(() => (BigInt(Date.now()) * 1000000n).toString());
  const invoices = useView<Invoice[]>("invoices_by_exporter", { account_id: accountId }, !!accountId);
  const config = useView<Config>("get_config", {}, !!accountId);
  const balance = useView<string>("ft_balance_of", { account_id: accountId }, !!accountId, usdcId());
  const rows = invoices.value || [];
  return <div className="tw-stack"><h1 className="tw-break">{accountId}</h1><Link className="tw-button" href="/app/new">New invoice</Link><ExportLinks accountId={accountId} /><ReadState loading={invoices.loading || config.loading} error={invoices.error || config.error || balance.error} retry={invoices.retry} />{invoices.value && <><div className="tw-kpis"><Kpi value={formatUsd(rows.reduce((sum, i) => sum + BigInt(i.face) - BigInt(i.paid.total) + BigInt(i.paid.overpaid), 0n))} label="Cash due" /><Kpi value={balance.value ? formatUsd(balance.value) : "—"} label="Cash on hand · USDC" /><Kpi value={formatUsd(rows.reduce((sum, i) => sum + BigInt(i.advance?.amount || "0"), 0n))} label="Advanced to date" /></div>{rows.length === 0 ? <Card title="Your next shipment starts here"><div className="tw-stack"><p>No invoices yet. Turn your next invoice into working capital.</p><Link className="tw-button" href="/app/new">Create your first invoice</Link><ol className="tw-first-steps"><li><strong>1 · Upload a PDF</strong><p>Check the document and confirm your invoice terms.</p></li><li><strong>2 · Invite your buyer</strong><p>Share the invoice so your buyer can accept it.</p></li><li><strong>3 · Get paid sooner</strong><p>Request an eligible advance; repayment is split automatically.</p></li></ol></div></Card> : config.value && <InvoiceTable invoices={rows} now={now} secondsPerDay={config.value.seconds_per_day} />}</>}</div>;
}
