"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
export function TelegramLink({ account: initial = "", role = "exporter" }: { account?: string; role?: "exporter" | "buyer" | "lp" }) {
  const [account, setAccount] = useState(initial), [linked, setLinked] = useState(false), [verified, setVerified] = useState(false);
  const [bot, setBot] = useState<string | null>(null), [url, setUrl] = useState(""), [qr, setQr] = useState(""), [message, setMessage] = useState("");
  const refresh = async () => {
    if (!account) return;
    try { const r = await fetch(`/api/telegram/link?account=${encodeURIComponent(account)}&role=${role}`); const b = await r.json(); if (r.ok) { setLinked(b.linked); setVerified(b.verified); setBot(b.bot_account_id); } } catch { setMessage("Unable to load Telegram status."); }
  };
  useEffect(() => { let active = true; if (account) fetch(`/api/telegram/link?account=${encodeURIComponent(account)}&role=${role}`).then(r => r.json()).then(b => { if (active) { setLinked(!!b.linked); setVerified(!!b.verified); setBot(b.bot_account_id); } }).catch(() => {}); return () => { active = false; }; }, [account, role]);
  async function action(unlink = false) {
    setMessage(""); setUrl(""); setQr("");
    try {
      const response = await fetch("/api/telegram/link", { method: unlink ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account_id: account, role }) });
      const result = await response.json();
      if (!response.ok) { setMessage(result.error || "Telegram unavailable"); return; }
      if (result.url) { setUrl(result.url); setQr(await QRCode.toDataURL(result.url, { width: 192, margin: 2 })); setMessage("One-time link expires in 10 minutes. Development link: unverified, wallet approval only."); }
      await refresh();
    } catch { setMessage("Unable to update Telegram link."); }
  }
  return <section className="tw-card tw-stack" aria-label="Telegram settings"><h2>{role === "buyer" ? "Telegram payment reminders" : "Telegram"}</h2>
    <label>NEAR account<input className="tw-input" value={account} onChange={event => setAccount(event.target.value)} placeholder="your-account.testnet" autoComplete="off" /></label>
    <p>{linked ? `Linked · ${verified ? "verified" : "unverified development link"}` : "Not linked · notifications are still available in the app."}</p>
    <div className="tw-toolbar"><button className="tw-button" disabled={!account} onClick={() => action()}>Link Telegram</button><button className="tw-ghost" disabled={!account} onClick={refresh}>Refresh status</button>{linked && <button className="tw-ghost" onClick={() => action(true)}>Unlink</button>}</div>
    {url && <><a className="tw-text-link tw-break" href={url} target="_blank" rel="noreferrer">{url}</a>{qr && <img src={qr} width={192} height={192} alt="One-time Telegram linking QR code" />}</>}
    {message && <p role="status">{message}</p>}
    <p className="tw-muted tw-small">Approvals authorise bot account: <code>{bot || "not configured"}</code>. Use the on-chain approvals toggle to opt in or revoke. Unlinking Telegram does not revoke set_approver. Buyer payments always require a wallet.</p>
  </section>;
}
