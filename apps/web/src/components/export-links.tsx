export function ExportLinks({ accountId }: { accountId: string }) {
  const query = `exporter=${encodeURIComponent(accountId)}`;
  return <div className="tw-toolbar">
    <a className="tw-ghost" href={`/api/export/invoices?${query}`} download>Export invoices CSV</a>
    <a className="tw-ghost" href={`/api/export/payments?${query}`} download>Export payments CSV</a>
  </div>;
}
