import { statusInfo, type InvoiceStatus } from "@tradewind/core";
import { Pill } from "./surfaces";
export function StatusChip({ status, overdue, detail }: { status: InvoiceStatus; overdue?: boolean; detail?: string }) {
  const { label, tone } = statusInfo(status, overdue);
  return <Pill tone={tone} value={detail ? `${label} · ${detail}` : label} />;
}
