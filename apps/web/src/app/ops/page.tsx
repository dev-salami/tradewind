import { OpsConsole } from "./console";
import { RelayerPanel } from "./relayer-panel";
export default function OpsPage() {
  return <div className="tw-stack"><header><p className="tw-eyebrow">Owner console</p><h1>Operations</h1></header><OpsConsole /><RelayerPanel /></div>;
}
