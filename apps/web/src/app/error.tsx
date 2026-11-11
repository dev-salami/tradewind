"use client";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="tw-card tw-state" role="alert"><h1>Could not load Tradewind data</h1><p>Check the selected network, RPC endpoint, and contract configuration. No sample data has been substituted.</p><button className="tw-button" onClick={reset}>Try again</button></section>;
}
