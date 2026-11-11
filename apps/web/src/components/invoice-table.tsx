"use client";
import Link from "next/link";
import { dueInText, formatUsd, type Invoice } from "@tradewind/core";
import { Avatar, DataTable } from "./kit";
import { StatusChip } from "./status-chip";
export function InvoiceTable({ invoices, now, secondsPerDay, receipts = false, title = "Your invoices" }: { invoices: Invoice[]; now: string; secondsPerDay: number; receipts?: boolean; title?: string }) {
  return <DataTable title={title} rows={invoices} rowKey={i => i.id}
    empty="No invoices yet. Create your first invoice after wallet connect."
    searchText={i => `${i.id} ${i.buyer_label} ${i.buyer}`}
    filters={{ label: "Invoice status", options: [...new Set(invoices.map(i => i.status))], value: i => i.status }}
    columns={[
      { key: "id", label: "Invoice", render: i => <Link className="tw-invoice-link" href={receipts ? `/r/${i.id}` : `/app/i/${i.id}`}>{i.id} ↗</Link>, sort: i => i.id },
      { key: "buyer", label: "Buyer", render: i => <span className="tw-person"><Avatar name={i.buyer_label} /><Link href={`/buyer/${i.buyer}`}>{i.buyer_label}</Link></span>, sort: i => i.buyer_label },
      { key: "value", label: "Value", className: "tw-money", render: i => formatUsd(i.face), sort: i => i.face.padStart(39, "0") },
      { key: "status", label: "Status", render: i => <StatusChip status={i.status} overdue={i.overdue} detail={i.status === "Funded" ? `${i.tenor_days} days` : undefined} /> },
      { key: "due", label: "Due", render: i => i.status === "Repaid" ? "Settled" : dueInText(now, i.due_at, secondsPerDay) },
    ]} />;
}
