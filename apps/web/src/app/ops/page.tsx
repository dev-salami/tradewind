import { Card, Pill } from "@/components/surfaces";
export default function OpsPage() {
  return <div className="tw-stack"><header><p className="tw-eyebrow">Owner console · locked</p><h1>Operations</h1><p className="tw-muted">Owner-only data and actions are available after wallet connect and owner authorization. This public shell exposes no queues or controls.</p></header>{["Pause / unpause", "LP allowlist", "Contract configuration", "Run keeper now", "Unattributed / overpaid funds · attribute or refund", "Unfreeze buyer"].map(title => <Card key={title} title={title} action={<Pill value="Owner wallet required" />}><p className="tw-muted">Available after wallet connect. Each action will require an owner-signed contract call.</p></Card>)}</div>;
}
