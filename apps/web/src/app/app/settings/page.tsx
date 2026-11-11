import { Card, Pill } from "@/components/surfaces";
import { TelegramLink } from "@/components/telegram-link";
export default function SettingsPage() {
  return <div className="tw-stack"><header><p className="tw-eyebrow">Workspace</p><h1>Settings</h1></header><TelegramLink />{[
    ["Link Telegram", "Telegram not linked. Receive invoice checks, payment reminders and advance notifications."],
    ["Telegram approvals", "Opt in to set_approver. Approvals can only send an advance to the exporter named on the invoice."],
    ["USDC storage registration", "Register your NEAR account on the selected USDC contract before receiving funds."],
  ].map(([title, body]) => <Card title={title} key={title} action={<Pill value="Available after wallet connect" />}><p className="tw-muted">{body}</p><button className="tw-ghost" disabled>Connect wallet first</button></Card>)}</div>;
}
