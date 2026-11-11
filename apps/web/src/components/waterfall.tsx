import { formatUsd, type WaterfallSplit } from "@tradewind/core";
import { waterfallWidths, WATERFALL_LANES } from "@/lib/waterfall";
export function WaterfallBars({ split }: { split: WaterfallSplit }) {
  const widths = waterfallWidths(split);
  const lanes = WATERFALL_LANES.filter(l => BigInt(split[l.key]) > 0n);
  const bottom = WATERFALL_LANES.reduce((max, _, i) => widths[i] > 0 ? Math.max(max, 30 + widths.slice(0, i + 1).reduce((sum, w) => sum + w * 1.6, 0) + i * 30) : max, 0);
  const height = Math.max(80, Math.ceil(bottom) + 16);
  const labels = ["LP pool principal", "LP yield", "Protocol fee", "Exporter remainder", "Overpaid · held for refund"];
  return <div className="tw-waterfall">
    <svg className="tw-sankey" viewBox={`0 0 640 ${height}`} data-height={height} role="img" aria-label={lanes.map(l => `${l.label} ${formatUsd(split[l.key], { decimals: 6 })}`).join(", ") || "No payment allocated"}>
      <text x="12" y="20" fill="currentColor" fontSize="13">Incoming payment · {formatUsd(WATERFALL_LANES.reduce((sum, lane) => sum + BigInt(split[lane.key]), 0n))}</text>
      {WATERFALL_LANES.map((lane, i) => {
        const thickness = widths[i] * 1.6, start = 30 + widths.slice(0, i).reduce((sum, width) => sum + width * 1.6, 0);
        const end = start + i * 30;
        return <g key={lane.key}><path className="tw-sankey-ribbon" data-testid="waterfall-segment" data-width={widths[i]} data-thickness={thickness} d={`M12 ${start} H85 C190 ${start} 210 ${end} 345 ${end} H380 V${end + thickness} H345 C210 ${end + thickness} 190 ${start + thickness} 85 ${start + thickness} H12 Z`} fill={lane.color} opacity={thickness ? 0.85 : 0} />{thickness > 0 && <text x="395" y={end + thickness / 2} dominantBaseline="middle" fill="currentColor" fontSize="12"><tspan x="395" dy="-3">{labels[i]}</tspan><tspan x="395" dy="16">{formatUsd(split[lane.key], { decimals: 6 })}</tspan></text>}</g>;
      })}
      {!lanes.length && <text x="12" y="65" fill="currentColor">No payment allocated</text>}
    </svg>
    <dl className="tw-split-legend">{WATERFALL_LANES.map((lane, i) => <div key={lane.key}><dt><i style={{ background: lane.color }} />{labels[i]}</dt><dd className="tw-money">{formatUsd(split[lane.key], { decimals: 6 })}</dd></div>)}</dl>
  </div>;
}
