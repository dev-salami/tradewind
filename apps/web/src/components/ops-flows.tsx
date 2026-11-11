"use client";
import { useState } from "react";
import type { StrayPayment } from "@tradewind/core";
import { coreId } from "@/lib/near";
import { isOwner } from "@/lib/wallet-logic";
import * as tx from "@/lib/tx";
import { useWallet } from "./wallet-provider";
import { ReadState, useView, WriteButton } from "./write-controls";
import { Card } from "./surfaces";
import { isFixtureMode } from "@/lib/data";
export function OpsFlows() {
  const { accountId } = useWallet();
  const roles = useView<{ owner: string }>("get_roles", {}, !!accountId);
  if (roles.loading && accountId && !isFixtureMode()) return <ReadState {...roles} />;
  if (roles.error) return <ReadState {...roles} />;
  if (!isOwner(accountId, roles.value?.owner)) return <p>Owner only</p>;
  return <OwnerConsole />;
}
function OwnerConsole() {
  const { callView } = useWallet();
  const config = useView<Record<string, unknown>>("get_config");
  const [account, setAccount] = useState(""), [check, setCheck] = useState("");
  const [id, setId] = useState(""), [to, setTo] = useState(""), [amount, setAmount] = useState("");
  const [offset, setOffset] = useState(0);
  const queue = useView<(StrayPayment & { resolved: boolean })[]>("list_unattributed", { from_index: String(offset), limit: 50 });
  return <div className="tw-stack"><Card title="Pause / unpause"><p>Repayments and keeper calls remain available while paused.</p><div className="tw-toolbar"><WriteButton build={() => tx.pauseTx(coreId())}>Pause</WriteButton><WriteButton build={() => tx.unpauseTx(coreId())}>Unpause</WriteButton></div></Card>
    <Card title="LP allowlist / unfreeze buyer"><div className="tw-form"><label>NEAR account<input value={account} onChange={e => { setAccount(e.target.value); setCheck(""); }} /></label><div className="tw-toolbar"><WriteButton disabled={!account} build={() => tx.lpAllowTx(coreId(), account, true)}>Allow LP</WriteButton><WriteButton disabled={!account} build={() => tx.lpAllowTx(coreId(), account, false)}>Remove LP</WriteButton><WriteButton disabled={!account} build={() => tx.unfreezeBuyerTx(coreId(), account)}>Unfreeze buyer</WriteButton><button className="tw-ghost" onClick={async () => { try { setCheck(await callView<boolean>("is_lp_allowed", { account_id: account }) ? "Allowed" : "Not allowed"); } catch (e) { setCheck(String(e)); } }}>Check LP access</button></div><p role="status">{check}</p></div></Card>
    <Card title="Contract configuration · read only"><ReadState {...config} />{config.value && <table><tbody>{Object.entries(config.value).map(([key, value]) => <tr key={key}><th>{key}</th><td><code>{JSON.stringify(value)}</code></td></tr>)}</tbody></table>}</Card>
    <Card title="Unattributed queue"><ReadState {...queue} />{queue.value?.length === 0 && <p>No unattributed payments.</p>}{queue.value?.map((payment, index) => <QueueRow key={offset + index} payment={payment} index={String(offset + index)} />)}<div className="tw-toolbar"><button className="tw-ghost" disabled={offset === 0} onClick={() => setOffset(n => Math.max(0, n - 50))}>Previous</button><button className="tw-ghost" disabled={queue.value?.length !== 50} onClick={() => setOffset(n => n + 50)}>Next</button></div></Card>
    <Card title="Overpaid refunds / run keeper now"><div className="tw-form"><label>Invoice id<input placeholder="TW-0042" value={id} onChange={e => setId(e.target.value)} /></label><label>Refund recipient<input value={to} onChange={e => setTo(e.target.value)} /></label><label>Refund USDC<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label><WriteButton disabled={!id || !to} build={() => tx.refundOverpaidTx(coreId(), id, to, tx.parseAmount(amount))}>Refund overpaid</WriteButton><p>Keeper calls are permissionless; anyone may mark an eligible invoice overdue or defaulted. These calls attach no deposit.</p><div className="tw-toolbar"><WriteButton disabled={!id} build={() => tx.markOverdueTx(coreId(), id)}>Mark overdue</WriteButton><WriteButton disabled={!id} build={() => tx.markDefaultTx(coreId(), id)}>Mark default</WriteButton></div></div></Card>
  </div>;
}
function QueueRow({ payment, index }: { payment: StrayPayment & { resolved: boolean }; index: string }) {
  const [invoice, setInvoice] = useState(""), [to, setTo] = useState("");
  return <section className="tw-form"><p>#{index} · {payment.sender} · {payment.amount} base units · {payment.resolved ? "Resolved" : "Unresolved"}</p><code className="tw-break">{payment.msg}</code>{!payment.resolved && <><label>Attribute to invoice<input value={invoice} onChange={e => setInvoice(e.target.value)} /></label><WriteButton disabled={!invoice} build={() => tx.attributeUnattributedTx(coreId(), index, invoice)}>Attribute</WriteButton><label>Refund to NEAR account<input value={to} onChange={e => setTo(e.target.value)} /></label><WriteButton disabled={!to} build={() => tx.refundUnattributedTx(coreId(), index, to)}>Refund unattributed</WriteButton></>}</section>;
}
