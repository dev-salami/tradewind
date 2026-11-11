import { GuidedMode } from "@/components/guided-mode";
import { network } from "@/lib/env-public";

export default function GuidedPage() {
  return network() === "mainnet" ? null : <GuidedMode />;
}
