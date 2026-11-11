"use client";
import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { LayoutGrid, Plus, Landmark, Users, Receipt, Settings } from "lucide-react";
import type { NearNetwork } from "@tradewind/core";
import { WalletMenu } from "./wallet-provider";
import { GuidedNavLink } from "./guided-mode";
const NAV = [
  { href: "/app", label: "Dashboard", icon: LayoutGrid },
  { href: "/app/new", label: "New invoice", icon: Plus },
  { href: "/pool", label: "Pool", icon: Landmark },
  { href: "/pool", label: "Buyers", icon: Users },
  { href: "/app/guided", label: "Receipts", icon: Receipt },
  { href: "/app/settings", label: "Settings", icon: Settings },
];
/** Adapted pill navigation from the supplied reference shell. */
export function AppShell({ children, network, showcase = null }: { children: React.ReactNode; network: NearNetwork; showcase?: { invoiceId: string; buyer: string } | null }) {
  const path = usePathname();
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const open = menuPath === path;
  return <div className="tw">
    <a href="#main" className="tw-skip">Skip to content</a>
    <header className="tw-top">
      <Link className="tw-logo" href="/" aria-label="Tradewind home"><img src="/brand/tradewind-logo.svg" alt="Tradewind" width="152" height="40" /></Link>
      <button className="tw-ghost tw-menu-button" aria-expanded={open} aria-controls="main-navigation" onClick={() => setMenuPath(open ? null : path)}>Menu</button>
      <nav id="main-navigation" className={`tw-nav${open ? " tw-nav-open" : ""}`} aria-label="Main navigation" onClick={() => setMenuPath(null)} onKeyDown={e => { if (e.key === "Escape") { setMenuPath(null); document.querySelector<HTMLButtonElement>(".tw-menu-button")?.focus(); } }}>{NAV.map(({ href: original, label, icon: Icon }) => {
        const href = label === "Buyers" ? (showcase ? `/buyer/${encodeURIComponent(showcase.buyer)}` : "/pool") : label === "Receipts" ? (showcase ? `/r/${encodeURIComponent(showcase.invoiceId)}` : "/app/guided") : original;
        const active = href === "/app" ? path === href || path.startsWith("/app/i/") : path.startsWith(href);
        return <Link key={label} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}><Icon size={15} aria-hidden="true" />{label}</Link>;
      })}{network !== "mainnet" && <GuidedNavLink active={path === "/app/guided"} />}</nav>
      <div className="tw-tools"><span className="tw-network">{network}</span>
        <WalletMenu />
      </div>
    </header>
    <main id="main" className="tw-main">{children}</main>
    <footer className="tw-footer"><img src="/brand/tradewind-mark.svg" alt="" width="24" height="24" />Tradewind · Invoice finance on stablecoin rails<Link href="/ops">Ops</Link></footer>
  </div>;
}
