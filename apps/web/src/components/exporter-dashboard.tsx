"use client";
import Link from "next/link";
import { formatUsd, type Invoice, type Config } from "@tradewind/core";
import { useWallet } from "./wallet-provider";
import { ReadState, useView } from "./write-controls";
import { InvoiceTable } from "./invoice-table";
import { Kpi } from "./surfaces";
import { usdcId } from "@/lib/near";
export function ExporterDashboard() {
  const { accountId } = useWallet();
  const invoices = useView<Invoice[]>("invoices_by_exporter", { account_id: accountId }, !!accountId);
  const config = useView<Config>("get_config", {}, !!accountId);
  const balance = useView<string>("ft_balance_of", { account_id: accountId }, !!accountId, usdcId());
  if (!accountId) return <p>Connect wallet to load your invoices.</p>;
  const rows = invoices.value || [];
  return <div className="tw-stack"><h1>{accountId}</h1><Link className="tw-button" href="/app/new">New invoice</Link><ReadState loading={invoices.loading || config.loading} error={invoices.error || config.error || balance.error} />{invoices.value && <><div className="tw-kpis"><Kpi value={formatUsd(rows.reduce((sum, i) => sum + BigInt(i.face) - BigInt(i.paid.total) + BigInt(i.paid.overpaid), 0n))} label="Cash due" /><Kpi value={balance.value ? formatUsd(balance.value) : "—"} label="Cash on hand · USDC" /><Kpi value={formatUsd(rows.reduce((sum, i) => sum + BigInt(i.advance?.amount || "0"), 0n))} label="Advanced to date" /></div>{rows.length === 0 && <p>Create your first invoice</p>}{config.value && <InvoiceTable invoices={rows} now={(BigInt(Date.now()) * 1000000n).toString()} secondsPerDay={config.value.seconds_per_day} />}</>}</div>;
}
