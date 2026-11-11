# Read-only chain event indexer

The worker registers `indexChain` separately from the existing cache/notification
job. The new job and backfill command import no wallet/signing code, never submit
transactions, and need no private keys. Normal operation accepts localhost or the
HTTPS testnet endpoints `*.testnet.near.org` and `testnet.fastnear.com` only.

## Configuration and recovery

Use an absolute `DATABASE_PATH` shared by worker and web, one database per chain
and deployment. Set:

```sh
NEAR_RPC_URL=http://127.0.0.1:3039
CORE_CONTRACT_ID=core.test.near
INDEXER_START_HEIGHT=123
INDEXER_MAX_BLOCKS=200
```

**START_HEIGHT must be the actual contract deploy block**, not genesis on testnet,
and not today's head. Record it with deployment metadata before wiping a DB.
`chain_cursor` records `deploy_height` and the next height; once initialized, its
cursor wins over the environment. No guessed deployment height is used. A wiped
database needs START_HEIGHT again (or an explicitly restored cursor). Pointing at
another deployment/RPC with the same DB is rejected. For a deliberate full replay,
use a fresh DB rather than manually advancing a cursor.

`POOL_CONTRACT_ID` optionally adds a separate pool executor and historical
`get_pool` target. Omit it for the current deployment, where core owns twPOOL and
pool accounting. A standalone share-token account is not a `get_pool` target.

## Scan, finality, and idempotency

Each tick reads the final head, at most 200 heights by default (configurable
1–2000), and all newly included chunks. It follows **every originating transaction**
through `EXPERIMENTAL_tx_status` with `wait_until: FINAL`. Filtering top-level
receivers would miss USDC `ft_transfer_call` deposits and repayments. The returned
execution graph contains chunk receipt outcomes and callbacks; only successful
outcomes whose executor is core/the configured pool are trusted. A transaction
may have both successful and failed receipts; reverted receipt logs are ignored.
Outcomes are assigned their own block hash/height/timestamp, not the originating
transaction's height. Outcomes newer than the tick's final head cause a retry
without advancing past that transaction's block.

This is intentionally a correctness-first scanner, not a high-throughput public
testnet firehose: it requests status for all originating transactions (even those
which ultimately do not touch core). Use a dedicated/archive endpoint for long
ranges. The height limit bounds scan range, not the number of transactions inside
a block. The contract deploy block must precede the relevant originating calls;
seed any transaction which started before that boundary explicitly.

`chain_events` stores `(block_height, tx_hash, receipt_id, idx, event, invoice_id,
data_json, ts)` with primary key `(receipt_id, idx)`. The parser accepts only
`tradewind` standard `1.0.0` names found in `contracts/tradewind/src`; NEP-141/171,
unsupported versions, malformed JSON, and ordinary logs are ignored. Amounts and
nanosecond timestamps remain strings. `idx` is stable across retries and data-array
expansion, including unrelated log positions.

Events, pool snapshots, and a processed transaction marker commit atomically.
The cursor advances only after a whole block succeeds. Partial completed
transactions are harmless on restart. An explicit UNKNOWN_BLOCK is treated as a
skipped height only when the next available block's `prev_height` proves the gap;
unproven gaps fail closed. A gap longer than the configured tick range requires
increasing that range. Transport/archival failures never silently advance the
cursor. HTTP 429 uses a per-endpoint cooldown and Retry-After (capped at 60s);
transport/5xx failures use bounded exponential backoff (four attempts).

## Optional known-transaction fast path

Each tick also accepts up to 200 recent rows per legacy table from
`automation_receipts` / `tx_log`, plus explicitly supplied `{hash,sender}` seeds.
Only hashes returned by those sources or chain RPC are used. `tx_log.account_id`
is used as sender when available; legacy worker receipts have no sender, so core
is used as a routing hint. Some RPC providers require the actual signer; supply
it explicitly in that case. Unknown/pruned/misrouted seeds increment
`seedFailures` but do not prevent the authoritative scan. Already indexed hashes
are not fetched again. An optional seed cannot replace complete deploy-to-head
coverage after DB loss.

The public receipt resolver prefers `chain_events` labels (created, verified,
accepted, funded, payment, repaid, defaulted, cancelled), merging labels for a
single transaction. Existing wallet/worker tables remain a fallback. Thus receipt
links can be reconstructed after a DB wipe once the replay catches up. Testnet
uses `testnet.nearblocks.io`, mainnet uses `nearblocks.io`, and sandbox shows the
hash without a link and with `local sandbox` in its detail.

## Share-price history

Deposit/redeem, fund/revert, payment/split, default, and administrative events
trigger a `get_pool` view pinned to **that event's block_id**. Event amounts do
not contain all accounting totals, including asynchronous reversions; no float
replay or current-state approximation is used. Multiple events in one block
produce one end-of-block snapshot. This needs historical state access: use an
archival testnet RPC for older events; localhost sandbox supports pinned views.
If a view fails, the originating block remains retryable.

For these records, `pool_snapshots.block` is the **real chain height**, and `ts`
is the corresponding block's nanosecond timestamp. `chain_snapshot_blocks`
identifies authoritative rows. The pool page joins that marker table so legacy
cache-job snapshots (whose `block` was a local sequence) do not masquerade as
chain history. Fixtures retain fixture history. Zero points show “No pool
activity yet”; one point shows a dot and value with no line/area; two or more
points show a line.

## One-shot backfill

Node 22 is required (`/opt/node-v22.23.4/bin/node` in this environment).

```sh
node scripts/backfill-events.mjs \
  --rpc http://127.0.0.1:3039 --contract core.test.near \
  --start-height 123 --db /tmp/opencode/chain-events.db --max-blocks 200
```

Optional explicit seed:

```sh
node scripts/backfill-events.mjs \
  --rpc http://127.0.0.1:3039 --contract core.test.near \
  --start-height 123 --db /tmp/opencode/chain-events.db \
  --known-txs '[{"hash":"ACTUAL_CHAIN_HASH","sender":"lp.test.near"}]'
```

Run again to continue until `nextHeight > finalHeight`. Each invocation is one
bounded indexer tick, printing JSON counts `blocks`, `events`, `snapshots`,
`seedFailures`, plus `nextHeight` and `finalHeight`. Mainnet/non-testnet endpoints
are refused before opening a DB or making a request unless the standalone command
has `--allow-mainnet-read`; this flag enables reads only. It is never enabled by
the worker. Do not supply signing keys.

### Sandbox verification

If an instance from `scripts/e2e-sandbox-setup.mjs` is already running, use its
generated env's RPC and core ID, and the recorded deploy height. The backfill
command does **not** run setup (setup deploys/signs and is outside this read-only
task). Check the deposit appears in `chain_events` and a pinned snapshot appears
at the deposit outcome height; rerun to confirm zero duplicate inserts. Repeat
against a fresh disposable DB and confirm identical receipt hashes/history.

During this implementation no sandbox responded at `127.0.0.1:3030` or `:3039`,
so live sandbox verification was unavailable. Automated tests use real-shaped
NEAR log/outcome fixtures and local read-only RPC simulation, not a claim of live
chain validation.

## Validation

`npm test` passes (393 tests); `npm run typecheck` and `npm run build` pass.
ESLint passes for all changed web source and test files. Full `npm run lint`
currently reports seven pre-existing React hooks/purity errors in unchanged
`any-chain-payment.tsx`, `create-invoice-flow.tsx`, `exporter-dashboard.tsx`,
`guided-mode.tsx`, `invoice-flows.tsx`, and `write-controls.tsx`, plus an existing
PostCSS configuration warning. Those files are outside this brief's edit scope
and were not changed or suppressed.
