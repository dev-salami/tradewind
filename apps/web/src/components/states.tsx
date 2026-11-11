import Link from "next/link";
export function EmptyState({ title = "Nothing here yet", children }: { title?: string; children?: React.ReactNode }) {
  return <section className="tw-card tw-state"><div className="tw-hatch" aria-hidden="true" /><h2>{title}</h2><p className="tw-muted">{children ?? "Data will appear here when it is available."}</p><Link href="/app" className="tw-ghost">Back to dashboard</Link></section>;
}
export function Skeleton() {
  return <div className="tw-stack" role="status" aria-label="Loading Tradewind data"><div className="tw-skeleton tw-skeleton-title" /><div className="tw-kpis tw-kpis-3">{[0, 1, 2].map(i => <div key={i} className="tw-skeleton tw-skeleton-card" />)}</div><div className="tw-skeleton tw-skeleton-table" /><span className="tw-muted">Loading on-chain views…</span></div>;
}
