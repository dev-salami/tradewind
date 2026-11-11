import { SettingsFlows } from "@/components/account-flows";
import { TelegramLink } from "@/components/telegram-link";
export default function SettingsPage() {
  return <div className="tw-stack"><header><p className="tw-eyebrow">Workspace</p><h1>Settings</h1></header><TelegramLink /><SettingsFlows /></div>;
}
