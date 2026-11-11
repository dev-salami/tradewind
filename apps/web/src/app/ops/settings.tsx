"use client";
import { useState } from "react";
import { Card } from "@/components/surfaces";
import { ReadState, useView, WriteButton } from "@/components/write-controls";
import { useWallet } from "@/components/wallet-provider";
import { isFixtureMode, network } from "@/lib/env-public";
import { coreId } from "@/lib/near";
import { editableKeys, settingsPreview, settingsTx } from "./settings-model";

export function EditableSettings() {
  const config = useView<Record<string, unknown>>("get_config");
  const { callView } = useWallet();
  const net = network();
  const [key, setKey] = useState("min_payment"), [value, setValue] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof settingsPreview> | null>(null);
  const [confirmed, setConfirmed] = useState(false), [error, setError] = useState("");
  const clear = () => { setPreview(null); setConfirmed(false); setError(""); };
  return <Card title="Editable settings"><ReadState {...config} />{config.value && <><details><summary>Current configuration</summary><pre>{JSON.stringify(config.value, null, 2)}</pre></details>{!isFixtureMode() && <form className="tw-form" onSubmit={e => { e.preventDefault(); try { setPreview(settingsPreview(config.value!, key, value, net)); setConfirmed(false); setError(""); } catch (e) { setPreview(null); setError(e instanceof Error ? e.message : "Invalid setting"); } }}>
    <label>Setting<select value={key} onChange={e => { clear(); setKey(e.target.value); }}>{editableKeys(net).map(k => <option key={k}>{k}</option>)}</select></label>
    <label>{key === "seconds_per_day" ? "New value (seconds)" : "New value (USDC)"}<input value={value} onChange={e => { clear(); setValue(e.target.value); }} /></label><button className="tw-button" type="submit">Preview diff</button>
  </form>}</>}{error && <p role="alert">{error}</p>}{preview && <section aria-label="Configuration diff"><h3>Review before signing</h3><p>Amounts below are integer base units (1 USDC = 1000000).</p><p><code>{preview.key}: {String(preview.before)} → {String(preview.after)}</code></p><p>All other config fields remain unchanged. The server never signs.</p>{net === "mainnet" && <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I understand this changes mainnet configuration.</label>}<WriteButton disabled={net === "mainnet" && !confirmed} build={async () => {
    if (net === "mainnet" && !confirmed) throw new Error("Confirm mainnet changes first");
    const access = await fetch("/api/ops", { cache: "no-store" });
    if (!access.ok || !(await access.json()).isOwner) throw new Error("Owner session expired. Sign in again before changing settings.");
    const current = await callView<Record<string, unknown>>("get_config");
    if (JSON.stringify(current) !== JSON.stringify(preview.original)) {
      const message = "Configuration changed. Review a fresh diff before signing.";
      setPreview(null); setConfirmed(false); setError(message); config.retry(); throw new Error(message);
    }
    return settingsTx(coreId(), preview.config);
  }} onSuccess={() => { clear(); config.retry(); }}>Sign configuration change</WriteButton></section>}</Card>;
}
