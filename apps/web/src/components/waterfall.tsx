import { formatUsd, type WaterfallSplit } from "@tradewind/core";
import { waterfallWidths, WATERFALL_LANES } from "@/lib/waterfall";
export function WaterfallBars({ split }: { split: WaterfallSplit }) {
  const widths = waterfallWidths(split);
  const lanes = WATERFALL_LANES.filter(l => BigInt(split[l.key]) > 0n);
  return <div className="tw-waterfall">
    <div className="tw-waterfall-track" role="img" aria-label={lanes.map(l => `${l.label} ${formatUsd(split[l.key], { decimals: 6 })}`).join(", ") || "No payment allocated"}>
      {WATERFALL_LANES.map((lane, i) => <span key={lane.key} data-testid="waterfall-segment" data-width={widths[i]} style={{ width: `${widths[i]}%`, background: lane.color }} />)}
    </div>
    <dl className="tw-split-legend">{WATERFALL_LANES.map(lane => <div key={lane.key}><dt><i style={{ background: lane.color }} />{lane.label}</dt><dd className="tw-money">{formatUsd(split[lane.key], { decimals: 6 })}</dd></div>)}</dl>
  </div>;
}
