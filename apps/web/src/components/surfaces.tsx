import type { ReactNode } from "react";

/** Shared reference-kit primitives: server-renderable, also safe in client tables. */
export function Card({ title, action, className = "", children, label }: { title?: ReactNode; action?: ReactNode; className?: string; children: ReactNode; label?: string }) {
  return <section className={`tw-card ${className}`} aria-label={label ?? (typeof title === "string" ? title : undefined)}>
    {(title || action) && <div className="tw-card-head">{title && <h2>{title}</h2>}{action}</div>}
    {children}
  </section>;
}

export function Kpi({ icon, value, label, dot, testId }: { icon?: ReactNode; value: ReactNode; label: string; dot?: string; testId?: string }) {
  return <div className="tw-card tw-kpi" data-testid={testId}><div className="tw-kpi-row"><span className="tw-kpi-icon" aria-hidden="true">{dot ? <span className="tw-kpi-dot" style={{ background: dot }} /> : icon}</span><strong>{value}</strong></div><span className="tw-kpi-label">{label}</span></div>;
}

export function Avatar({ name, size = 34, tone }: { name: string; size?: number; tone?: number }) {
  const t = tone ?? [...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 4;
  const initials = name.split(/\s+/).slice(0, 2).map(word => word[0]).join("");
  return <span className={`tw-ava tw-ava-${t}`} style={{ width: size, height: size, fontSize: size * .36 }} aria-hidden="true">{initials || "?"}</span>;
}

export function Pill({ value, dot = true, tone = "slate" }: { value: string; dot?: boolean; tone?: "green" | "amber" | "coral" | "slate" }) {
  return <span className={`tw-pill tw-pill-${tone}`}>{dot && <span className="tw-pill-dot" aria-hidden="true" />}{value.replace(/^./, c => c.toUpperCase())}</span>;
}
