# Tradewind

**Get paid today for invoices your buyers pay in 60 days.**

Tradewind is an invoice-advance protocol on NEAR: an exporter uploads an invoice, a private AI model in a NEAR AI Cloud TEE checks it, the buyer accepts it on-chain (minting the invoice as an NFT), a USDC pool advances 70–85% based on the buyer's on-chain repayment record, and the buyer later pays from any chain via NEAR Intents. The contract repays the pool first, then a small protocol fee, then the exporter.

> Work in progress for NEAR HACKATHON. See [`docs/SPEC.md`](docs/SPEC.md) and the build status in [`docs/CHECKLIST.md`](docs/CHECKLIST.md).

## Web foundation

The npm workspace contains `@tradewind/core` (pure TypeScript) and `@tradewind/web` (Next.js 16). With Node 22+, run `npm install`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run dev`. The web app defaults to clearly labelled sample fixtures; no wallet or payment operation is enabled.

See [`docs/WEB_FOUNDATION.md`](docs/WEB_FOUNDATION.md) for routes, datasource setup, reference UI reuse, reviewer notes, and contract integration assumptions.

## License

MIT — see [LICENSE](LICENSE).
