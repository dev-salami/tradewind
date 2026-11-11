# Telegram and worker

Node 22.13+ is required for `node:sqlite`. Run `npm install` at the root (the existing lockfile needs regeneration for the new dependencies/workspace), then run `npm run worker` alongside the web app. Dependency installation, tests and builds are intentionally left to the reviewer in this environment.

Use the **same absolute `DATABASE_PATH`** in both processes. With the documented npm workspace scripts, the defaults both resolve to `apps/web/data/tradewind.db`; an explicit absolute path is required for other launch directories. Use separate databases per network and per fixtures/RPC mode. SQLite WAL and a busy timeout allow both processes to share it. The worker runs sequential ticks (no overlapping jobs), persists snapshots and deduplicates notifications and reminder steps. Pool snapshot `block` values are local sequence keys, not RPC block heights.

`NEXT_PUBLIC_DATA_SOURCE=fixtures` (the default) is a labelled sample-only mode and disables all worker signing and RPC access. `rpc` uses contract views, including paginated `list_invoices(from_index, limit)`. A worker restart does not replay missed reminder windows: it sends only the currently due contract-day step. Telegram delivery is at-least-once with a lease, five attempts and exponential backoff. A crash after Telegram accepts a message but before the DB update can duplicate delivery; invoice/card creation and reminder scheduling remain idempotent.

Without `TELEGRAM_BOT_TOKEN`, the notifier retains each card with `skipped_no_token`. The Notifications panel on `/app` reads these cards for a NEAR account. Callback capabilities are never returned by that API; approving in the web panel opens the wallet-signing page. Start the worker to populate the panel, including in fixture mode. Skipped cards are not replayed automatically when a token is added.

## Linking and approvals

No wallet-auth module exists in this base. Account-based linking/unlinking is allowed only outside production, requires a same-origin request, and stores **unverified** links. Unverified links may receive notifications but **cannot invoke bot signing**, even if the exporter opted in on-chain. Production linking intentionally returns 401 until NEP-413 wallet-session authentication is integrated. Do not treat the account input as proof of ownership or manually promote unverified links.

Codes are random 128-bit, expire in ten minutes, and are deleted atomically on private-chat `/start`. Telegram callbacks are random 128-bit, user/terms/amount-bound, expire in thirty minutes and are claimed atomically before signing. The contract still guards terms, minimum advance and caller authority. Failed or uncertain sends consume the token: check the invoice and transaction before requesting another approval. Webhook handling fails closed if its secret is missing or wrong. `/stop` removes all of the Telegram user's links and pending callback/delivery capabilities. Unlinking does not revoke the on-chain approver; use the wallet's `set_approver(null)` flow.

Only a function-call key restricted to `request_advance` should be used for the bot. The keeper key must be restricted to `mark_overdue,mark_default`. No owner key is needed. Provisioning keys, creating a bot, setting its webhook and deployment are intentionally outside this change.

## Receipts and history

`/api/pool/history` and the existing pool chart use SQLite snapshots in RPC mode and fixtures in fixture mode. The worker reads `tx_log` only when it exists and has `invoice_id` and `tx_hash` columns; otherwise it skips merging (TODO: reconcile the wallet worktree's final schema). Indexed hashes and reminder history appear on public receipts. Payment splits are reconstructed with integer waterfall math, one card per newly observed payment; no chain-of-origin is invented from a settlement-only view.

## Environment variable names

- Shared: `DATABASE_PATH`, `NEXT_PUBLIC_DATA_SOURCE`, `NEAR_NETWORK`, `NEAR_RPC_URL`, `CORE_CONTRACT_ID`, `NEXT_PUBLIC_NEAR_NETWORK`, `NEXT_PUBLIC_CORE_CONTRACT_ID`, `PUBLIC_BASE_URL`
- Worker: `WORKER_INTERVAL_MS`, `KEEPER_ACCOUNT_ID`, `KEEPER_PRIVATE_KEY`
- Optional Telegram delivery/linking: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`
- Optional opted-in bot signing (verified links only): `BOT_ACCOUNT_ID`, `BOT_PRIVATE_KEY`
- Runtime: `NODE_ENV`

The bot token is not required for indexing, reminders, history or in-app notifications. No credentials belong in source or logs.
