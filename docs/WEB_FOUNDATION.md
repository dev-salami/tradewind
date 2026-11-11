# Web foundation

## Workspace map

- `packages/core/src`: contract JSON types, exact base-unit money/fee/share/waterfall calculations, status and contract-day helpers, SHA-256 terms/document hashing, fetch-only NEAR views, deterministic fixtures, async datasource interface.
- `packages/core/tests`: spec table rows, rounding and share protection, both partial-payment splits, hash vectors, fixture ledger consistency, mocked RPC requests and error paths.
- `apps/web/src/app`: Next.js App Router pages, loading/error/not-found boundaries, Sora, Tailwind 4 and the Tradewind theme.
- `apps/web/src/components`: reusable UI kit, charts, pill navigation, network banner, invoice panels, waterfall and chain selector.
- `apps/web/src/lib`: datasource/environment selection and exact visual waterfall allocation.
- `apps/web/public/brand`: supplied logo assets; `src/app/icon.svg` uses the supplied app icon.

## Reviewer commands

Use Node 22 or newer, at the repository root:

```sh
npm install
npm run typecheck
npm test
npm run lint
npm run build
npm run dev
```

No lockfile was authored. Dependencies and tests could not be run in the authoring environment (no Node/npm). The build uses `next/font/google` to obtain Sora and therefore needs Google Fonts access or the reviewer's normal font-fetch build cache. Standalone output is configured; the usual standalone deployment must also copy the web public assets and `.next/static` into the appropriate output paths.

## Data modes

Empty `NEXT_PUBLIC_DATA_SOURCE` defaults to `fixtures`. `NEXT_PUBLIC_NEAR_NETWORK` defaults to `testnet`; `sandbox` and `mainnet` are also supported. Copy `.env.example` into **`apps/web/.env.local`** for Next.js, then set only the values needed locally. Never commit secrets. Public variables are build-time settings; changing them requires rebuilding the app.

For RPC mode set `NEXT_PUBLIC_DATA_SOURCE=rpc`, `NEXT_PUBLIC_CORE_CONTRACT_ID`, and the selected network. `NEAR_RPC_URL` is an optional server-side endpoint override. Otherwise the shared presets are used. The app never silently substitutes fixtures for an RPC error. RPC pages are rendered dynamically with uncached, finalized view calls. The pay shell does not request quotes or call external payment services; it only loads its invoice through the selected datasource.

Fixture helpers support `fixtureData({stage: "PartiallyPaid"})` or `makeFixtures("Repaid")` for tests and future walkthroughs. The app's default stage is Funded. The clock is fixed for deterministic samples. These helpers do not simulate wallet transactions.

## Reference UI reuse

Adapted the supplied local reference's Card, Kpi, Avatar, Pill, DataTable, Select and useToast; retained searchable/filterable/sortable/paged tables, rounded cards, soft KPI hierarchy, hatch decoration, and toast layout. Adapted its pill navigation pattern without its account/session assumptions, and its AreaLine, Donut, Segments and StackedBars SVG charts. Replaced domain-specific labels, status mappings, routes and CSS scope with Tradewind equivalents (`.tw`, `tw-*`). Re-skinned with navy, green, amber, off-white, slate and coral, Sora, tabular money figures, and the supplied logo assets. The concept frames and scene code informed the token card, private-check badge, signature chip, waterfall and mobile chain ring. No reference application data or backend was copied.

## Deliberate gaps / contract integration assumptions

- All write controls, wallet connect, invoice upload, LP position, Telegram linking, payment quotes, and browser proof verification are deliberately disabled. Cash on hand is unknown without a wallet/balance view, not inferred from historical invoice receipts.
- Invoice views have timestamps and payment references, **not transaction hashes**. Timeline slots explicitly report missing transaction links. NearBlocks account links are labelled as account links, never represented as transaction proof. The later indexer should supply lifecycle/payment transaction hashes and origin-chain receipts.
- §6.8 does not expose a historical pool view. RPC `poolHistory()` returns an empty series until an event indexer is available; it does not fabricate history from current totals.
- Scalar `preview_deposit(a)` / `preview_redeem(s)` are assumed to return U128 JSON strings. Pagination uses numeric `from` / `limit`; account arguments use `acct` and invoice arguments use `id`, matching the written spec. Confirm those against the separately developed Rust contract.
- The buyer view includes computed `rate_bps` and `buyer_limit`; pool includes `protocol_fees_paid`, as requested in this brief. `is_lp_allowed(acct)` is included although omitted from the spec's short view list. These need ABI confirmation.
- Fixtures replay a **$20 seed**, four small advanced/paid invoices (pool fees $0.12), a separate Harbor advance and a Northgate write-off. Consequently their current pool assets are $19.42, **not falsely fixed at $20 or $20.15**. The isolated §6.6 test covers the $20 → $20.15 example. Gulf Foods starts with 3 on-time + 1 grace, score 10, and its $8 advance is locked at 80%.
- Sample AI signatures are intentionally illustrative and invalid, labelled next to the badge. No fixture is claimed as a real mainnet run. Mainnet runs are marked coming soon unless the active datasource is RPC on mainnet.
- Ops is only a public locked placeholder; no owner data or mutating endpoints are exposed. Wallet authentication and owner gating must precede enabling it.

Contracts and Rust manifests are outside this change.
