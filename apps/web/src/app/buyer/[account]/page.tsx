import { notFound } from "next/navigation";
import { formatUsd } from "@tradewind/core";
import { data, isFixtureMode, nowNs, network } from "@/lib/data";
import { Card, Kpi, Pill } from "@/components/surfaces";
import { InvoiceTable } from "@/components/invoice-table";
export default async function BuyerRecordPage({ params }: { params: Promise<{ account: string }> }) {
  const { account } = await params;
  const source = data();
  const [record, invoices, config] = await Promise.all([source.getBuyerRecord(account), source.invoicesByBuyer(account), source.getConfig()]);
  if (!record) notFound();
  const defaulted = invoices.find(i => i.status === "Defaulted");
  return <div className="tw-stack"><header><p className="tw-eyebrow">Public buyer record</p><h1>{invoices[0]?.buyer_label ?? account}</h1><p className="tw-muted tw-break">{account}{isFixtureMode() && " · sample account"}</p><p className="tw-muted tw-small">{isFixtureMode() ? "Sample preview · not mainnet evidence" : `Record built from on-chain invoices · ${network()}`}</p></header>
    {record.frozen && <div className="tw-alert" role="note">{defaulted ? `Not eligible: default on ${defaulted.id}` : "Not eligible: buyer frozen"} · Owner review required</div>}
    <div className="tw-kpis tw-kpis-3"><Kpi value={record.score} label="On-chain score" /><Kpi value={`${record.rate_bps / 100}%`} label="Current advance rate" /><Kpi value={formatUsd(record.buyer_limit)} label="Buyer exposure limit" /></div>
    <div className="tw-row-2"><Card title="Repayment record" action={<Pill value={record.frozen ? "Frozen" : "Eligible record"} tone={record.frozen ? "coral" : "green"} />}><table className="tw-table"><tbody>{[
      ["Accepted", record.accepted], ["Repaid on time", record.repaid_on_time], ["Repaid within grace", record.repaid_grace], ["Repaid late", record.repaid_late], ["Defaulted", record.defaulted], ["Recovered after default", record.recovered],
    ].map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td className="tw-money">{value}</td></tr>)}</tbody></table></Card><Card title="Exposure & scoring"><dl className="tw-details"><div><dt>Repaid volume</dt><dd>{formatUsd(record.repaid_volume)}</dd></div><div><dt>Open principal</dt><dd>{formatUsd(record.open_principal)}</dd></div></dl><p className="tw-muted">On time +3 · grace +1 · late −3 · default −15 and frozen. A recovered default stays frozen until owner review.</p></Card></div>
    <InvoiceTable title="Invoice history" invoices={invoices} now={nowNs()} secondsPerDay={config.seconds_per_day} receipts />
  </div>;
}
