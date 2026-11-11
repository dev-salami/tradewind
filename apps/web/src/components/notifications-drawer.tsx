"use client";
import { useEffect, useState } from "react";
import type { TelegramCard } from "@tradewind/core";
interface Notification { id: number; payload: TelegramCard; status: string }
export function NotificationsDrawer() {
  const [account, setAccount] = useState(""), [rows, setRows] = useState<Notification[]>([]), [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    async function refresh() {
      if (!account) { setRows([]); return; }
      try { const response = await fetch(`/api/notifications?account=${encodeURIComponent(account)}`); const body = await response.json(); if (active) { setRows(response.ok ? body : []); setMessage(response.ok ? "" : body.error); } } catch { if (active) setMessage("Notifications unavailable."); }
    }
    void refresh(); const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [account]);
  return <details className="tw-card"><summary>Notifications</summary><div className="tw-stack"><label>NEAR account<input className="tw-input" value={account} onChange={event => setAccount(event.target.value)} placeholder="your-account.testnet" /></label><p className="tw-muted tw-small">Public invoice notifications · no Telegram token needed. Signing actions open the invoice in your wallet.</p>{message && <p role="status">{message}</p>}{!rows.length && <p>No notifications yet. The worker records cards here as invoices change.</p>}{rows.map(row => <article key={row.id} style={{ background: "#e8f5ee", borderRadius: "16px 16px 16px 4px", padding: 16, maxWidth: 560 }}><div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }} dangerouslySetInnerHTML={{ __html: row.payload.text }} /><div className="tw-toolbar">{row.payload.buttons.filter(b => b.url).map((button, index) => <a className="tw-ghost" key={index} href={button.url}>{button.text}</a>)}</div><small className="tw-muted">{row.status}</small></article>)}</div></details>;
}
