"use client";
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body><main><h1>Tradewind is unavailable</h1><p>Check the network and datasource environment settings, then retry.</p><button onClick={reset}>Try again</button></main></body></html>;
}
