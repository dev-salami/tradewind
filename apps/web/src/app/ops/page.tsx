import { OpsFlows } from "@/components/ops-flows";
import { RelayerPanel } from "./relayer-panel";
export default function OpsPage() {
  return <div className="tw-stack"><header><p className="tw-eyebrow">Owner console</p><h1>Operations</h1></header><OpsFlows /><RelayerPanel /></div>;
}
