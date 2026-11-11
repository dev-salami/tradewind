"use client";
import { useId, useState } from "react";
const GREEN = "#00C08B";

export function Hatch({
  id,
  color = "#d9d9d9",
  bg = "transparent",
  gap = 7,
  width = 1.6,
}: {
  id: string;
  color?: string;
  bg?: string;
  gap?: number;
  width?: number;
}) {
  return (
    <pattern
      id={id}
      width={gap}
      height={gap}
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(45)"
    >
      <rect width={gap} height={gap} fill={bg} />
      <line x1="0" y1="0" x2="0" y2={gap} stroke={color} strokeWidth={width} />
    </pattern>
  );
}

/** Reference rounded stacked bars and hatch decoration, adapted for pool activity. */
export function StackedBars({ data, max }: { data: { label: string; a: number; b: number; cap: number; selected?: boolean }[]; max: number }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <p className="tw-empty">No pool activity yet.</p>;
  const W = 520, H = 220, slot = W / data.length, bw = Math.min(52, slot * .66);
  return <svg viewBox={`0 0 ${W} ${H + 30}`} className="tw-chart" role="img" aria-label="Pool activity: principal, fees, and available capacity">
    <defs><Hatch id={`bars${id}`} color="#c6d6cd" bg="#f6f4ef" gap={9} width={2} /></defs>
    {data.map((d, i) => {
      const x = i * slot + (slot - bw) / 2;
      const scale = (v: number) => Math.max(0, v) / Math.max(1, max) * H;
      const a = scale(d.a), b = scale(d.b), free = scale(Math.max(0, d.cap - d.a - d.b));
      return <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} opacity={hover === null || hover === i ? 1 : .55}>
        <title>{d.label}: principal {d.a}, fees {d.b}, available capacity {Math.max(0, d.cap - d.a - d.b)}</title>
        <rect x={x} y={H - a} width={bw} height={a} rx={10} fill={GREEN} />
        <rect x={x} y={H - a - b - 4} width={bw} height={b} rx={10} fill="#F5A524" />
        <rect x={x} y={H - a - b - free - 8} width={bw} height={free} rx={10} fill={`url(#bars${id})`} />
        <text x={x + bw / 2} y={H + 22} textAnchor="middle" className="tw-axis" fontSize={11}>{d.label}</text>
      </g>;
    })}
  </svg>;
}

function smooth(points: [number, number][]) {
  if (points.length < 2) return "";
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}
/** Soft area line chart. */
export function AreaLine({
  labels,
  values,
  format,
}: {
  labels: string[];
  values: number[];
  format: (v: number) => string;
}) {
  const id = useId().replace(/:/g, "");
  const W = 560;
  const H = 210;
  const left = 46;
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 1;
  const padding = Math.max(Math.abs(low), Math.abs(high), 1) * .005;
  const min = low - padding, max = high + padding;
  const xs = labels.map(
    (_, i) => left + i * ((W - left - 12) / (labels.length - 1 || 1)),
  );
  const y = (v: number) => 14 + (H - 14) * (1 - (v - min) / (max - min));
  const pts = values.map((v, i) => [xs[i], y(v)] as [number, number]);
  const line = smooth(pts);
  const [selection, setSel] = useState(0);
  const sel = Math.min(Math.max(0, selection), Math.max(0, values.length - 1));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + (max - min) * f);
  if (!values.length || values.length !== labels.length) return <p className="tw-empty">No share-price history yet.</p>;
  return (
    <svg
      viewBox={`0 0 ${W} ${H + 30}`}
      className="tw-chart"
      role="img"
      aria-label="Pool share price over time"
    >
      <defs>
        <linearGradient id={`a${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={GREEN} stopOpacity="0.35" />
          <stop offset="1" stopColor={GREEN} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <text x={0} y={y(t) + 4} className="tw-axis" fontSize="10">
            {format(t)}
          </text>
          <line x1={left} x2={W} y1={y(t)} y2={y(t)} stroke="#f0f0f0" />
        </g>
      ))}
      <path
        d={`${line} L${xs[xs.length - 1]},${H} L${xs[0]},${H} Z`}
        fill={`url(#a${id})`}
      />
      <path d={line} fill="none" stroke="#00C08B" strokeWidth={2.2} />
      {labels.map((l, i) => (
        <g
          key={l + i}
          onMouseEnter={() => setSel(i)}
          onClick={() => setSel(i)}
          className="tw-chart-hit"
        >
          <rect
            x={xs[i] - 30}
            y={0}
            width={60}
            height={H + 30}
            fill="transparent"
          />
          <text
            x={xs[i]}
            y={H + 22}
            textAnchor="middle"
            className="tw-axis"
            fontSize="10.5"
          >
            {i === 0 || i === labels.length - 1 || i % Math.ceil(labels.length / 4) === 0 ? String(i + 1) : ""}
          </text>
        </g>
      ))}
      <circle
        cx={pts[sel][0]}
        cy={pts[sel][1]}
        r={4.5}
        fill="#00C08B"
        stroke="#fff"
        strokeWidth={2}
      />
      <g
        transform={`translate(${Math.min(W - 84, Math.max(left, pts[sel][0] - 40))},${Math.max(0, pts[sel][1] - 38)})`}
      >
        <rect width={80} height={24} rx={12} fill="#fff" stroke="#ececec" />
        <circle cx={12} cy={12} r={3} fill="#00C08B" />
        <text x={21} y={16} fontSize="11" fill="#0B1F33">
          {format(values[sel])}
        </text>
      </g>
    </svg>
  );
}

/** Hatched donut with an emphasised main segment. */
export function Donut({
  segments,
  centerLabel,
  centerValue,
  size = 250,
}: {
  segments: { label: string; value: number; color: string; hatch: string }[];
  centerLabel: string;
  centerValue: string;
  size?: number;
}) {
  const id = useId().replace(/:/g, "");
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  if (!segments.length || segments.every(s => s.value === 0)) return <p className="tw-empty">No pool assets yet.</p>;
  const R = 100;
  const r = 62;
  const arc = (start: number, end: number, outer: number, inner: number) => {
    const large = end - start > Math.PI ? 1 : 0;
    const p = (ang: number, rad: number) =>
      `${110 + rad * Math.cos(ang)},${110 + rad * Math.sin(ang)}`;
    return `M${p(start, outer)} A${outer},${outer} 0 ${large} 1 ${p(end, outer)} L${p(end, inner)} A${inner},${inner} 0 ${large} 0 ${p(start, inner)} Z`;
  };
  const main = segments.reduce(
    (m, s, i) => (s.value > segments[m].value ? i : m),
    0,
  );
  return (
    <svg
      viewBox="0 0 220 220"
      width={size}
      height={size}
      className="tw-donut"
      role="img"
      aria-label={`${centerLabel}: ${segments.map((s) => `${s.label} ${Math.round((s.value / total) * 100)}%`).join(", ")}`}
    >
      <defs>
        {segments.map((s, i) => (
          <Hatch
            key={i}
            id={`d${id}${i}`}
            color={s.hatch}
            bg="#fff"
            gap={6}
            width={1.3}
          />
        ))}
      </defs>
      {segments.map((s, i) => {
        const span = (s.value / total) * Math.PI * 2;
        const start = -Math.PI / 2 + segments.slice(0, i).reduce((sum, s) => sum + s.value / total * Math.PI * 2, 0);
        const end = start + Math.max(span - 0.02, 0.001);
        if (s.value <= 0) return null;
        const isMain = i === main;
        return (
          <g key={s.label}>
            <path
              d={arc(start, end, isMain ? R + 6 : R, isMain ? r - 4 : r)}
              fill={isMain ? s.color : `url(#d${id}${i})`}
              stroke={isMain ? "none" : s.hatch}
              strokeOpacity={0.35}
            />
            {span > 0.3 && (
              <g
                transform={`translate(${110 + (R - 19) * Math.cos(end - 0.1)},${110 + (R - 19) * Math.sin(end - 0.1)}) rotate(${((end - 0.1) * 180) / Math.PI + 90})`}
              >
                <rect
                  x={-13}
                  y={-8}
                  width={26}
                  height={16}
                  rx={8}
                  fill="#fff"
                  opacity={0.85}
                />
                <circle cx={-5} cy={0} r={1.4} fill="#c9c9c9" />
                <circle cx={0} cy={0} r={1.4} fill="#c9c9c9" />
                <circle cx={5} cy={0} r={1.4} fill="#c9c9c9" />
              </g>
            )}
          </g>
        );
      })}
      <text x={110} y={102} textAnchor="middle" fontSize="12" fill="#5B6B7F">
        {centerLabel}
      </text>
      <text
        x={110}
        y={130}
        textAnchor="middle"
        fontSize="28"
        fontWeight="300"
        fill="#0B1F33"
      >
        {centerValue}
      </text>
    </svg>
  );
}
/** Segmented progress. */
export function Segments({
  value,
  total,
  color,
}: {
  value: number;
  total: number;
  color: string;
}) {
  const n = 28;
  const on = Math.round((value / Math.max(total, 1)) * n);
  return (
    <div
      className="tw-segs"
      role="meter"
      aria-label="Idle liquidity percentage"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={value}
    >
      {Array.from({ length: n }, (_, i) => (
        <span key={i} style={{ background: i < on ? color : "#efefef" }} />
      ))}
    </div>
  );
}
