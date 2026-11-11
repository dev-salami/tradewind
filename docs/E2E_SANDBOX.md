# Local-sandbox end-to-end check

This check runs the real web app and worker against contracts deployed on a
**local** `near-sandbox` node. Nothing touches testnet or mainnet, and no real
funds are involved. The setup script refuses any RPC URL that is not localhost.

## Steps

1. Run `make build`. This builds the wasm into `target/near/`.

2. Start a sandbox. The binary is downloaded by `near-workspaces` during `make test`; look for it under `target/*/build/near-sandbox-*/out/.near/`:

   ```sh
   SB=$(ls target/*/build/near-sandbox-*/out/.near/near-sandbox-*/near-sandbox | head -1)
   $SB --home /tmp/tw-sb init && $SB --home /tmp/tw-sb run --rpc-addr 0.0.0.0:3039 &
   ```

3. Deploy and seed:

   ```sh
   node scripts/e2e-sandbox-setup.mjs /tmp/tw-sb http://127.0.0.1:3039 /tmp/tradewind-e2e.env
   ```

   This creates throwaway sub-accounts of `test.near`:
   - core;
   - mock USDC;
   - attester, keeper and treasury;
   - a guided exporter and buyer;
   - an LP and `gulf-foods` showcase buyer.

   It registers token storage, allowlists the LP, and mints/deposits **1,000
   tUSDC** so concurrent advances fit. It seeds four $2 on-time repayments for
   `gulf-foods`, plus three $2 repayments for the buyer root. With the default
   `invoice_counter_start=35`, those seven invoices get IDs 35..41; the next is
   **TW-0042**, invoice number TW-0042, $10 Net 60, MOCK verification, buyer
   acceptance, advance and two repayments ($6 + $4). Four Gulf Foods seed
   repayments give score 12 before the showcase (15 afterwards), not score 10.
   The script verifies Repaid on chain and writes the **actual returned**
   `SHOWCASE_INVOICE_ID` and `SHOWCASE_BUYER` into the env file. It does not reset
   counters on existing contracts; setup is fresh-deployment-only.

   The env file holds **local-sandbox-only** keys and a generated SESSION_SECRET
   (mode 600). Never commit it. Keep the guided buyer root funded: each browser
   session receives 0.5 test NEAR by default (`GUIDED_BUYER_FUND_NEAR`).

4. Build and start the web app with that env. `NEXT_PUBLIC_*` values are baked in at build time:

   ```sh
   cd apps/web && set -a && . /tmp/tradewind-e2e.env && set +a
   export PUBLIC_BASE_URL=http://localhost:3312
   npm run build && npx next start -p 3312
   ```

5. Drive the loop through guided mode, either at `/app/guided` or with curl (`Origin: http://localhost:3312`, use `-c /tmp/tw-cookies -b /tmp/tw-cookies` to preserve the signed `tw_guided` cookie):
   1. `POST /api/guided/invoice` → `accept` → `advance`;
   2. `pay` with `{"amount":"6000000"}`;
   3. `pay` again for the rest.

6. Start the worker with the same env: `cd apps/worker && npx tsx src/index.ts`.
   - It indexes invoices, snapshots the share price, sends T−7…T+7 reminders to the log, runs guided cleanup, then runs the keeper for non-session invoices.
   - Guided cleanup uses the same SQLite database and SESSION_SECRET. At ten wall-clock minutes (`GUIDED_STALE_MINUTES`) it cancels abandoned unfunded invoices (Accepted requires worker-only OWNER_ACCOUNT_ID / OWNER_PRIVATE_KEY, 1 yoctoNEAR) and fully repays funded ones from their isolated session buyers. Missing `cancel_invoice` logs `cancel_unavailable`; session invoices are excluded from keeper defaulting even on cleanup failure.
   - For an ordinary non-guided 1-day invoice, the keeper calls `mark_overdue` at the due date and `mark_default` after `default_after_days`. One day is 10 seconds on the demo clock.

## Testnet showcase (preview first)

`scripts/testnet/06-showcase.sh` provides the same seven-seed + showcase flow
using mock tokens and CLI commands. On a **fresh deployment**, run 01..03 then
06 **instead of 04** (do not double-seed). It creates `gulf-foods.<ROOT>`, deposits
1,000 tUSDC and uses four Gulf Foods plus three BUYER2 seed repayments. The
default counter starts at 35, so showcase is 42; if deployment configuration or
prior activity differs, use the returned ID rather than assuming it.
The account setup now gives the buyer root 10 test NEAR and exporter 5 test
NEAR; top up the root as sessions consume their default 0.5 test NEAR allocations.

`ROOT=... DRY_RUN=1 bash scripts/testnet/06-showcase.sh` prints commands only and
does not touch the network or write files. After review, `DRY_RUN=0` executes on
**testnet only** and writes the two showcase variables to `SHOWCASE_ENV_FILE`
(default `tradewind-showcase.env`), preserving other env lines. Point that at
your shared env file, or copy the two values into it. Never commit an env file.

## Historical audit run (2026-11-11, before multi-session changes)

- **Guided loop: Created → Verified (MOCK) → Accepted → Funded → PartiallyPaid → Repaid.**
  - Face $10.00, new buyer rate 70%, advance $7.00.
  - Waterfall: $7.00 pool principal, $0.15 pool fee, $0.05 protocol, $2.80 exporter.
  - Every lifecycle tx was recorded in `tx_log` with its method and kind.
- **Pages render from RPC with HTTP 200 and no server errors.**
  - Pages checked: `/app`, `/app/i/:id`, `/r/:id`, `/b/:id`, `/pay/:id`, `/pool`, `/buyer/:account`, `/ops`, `/app/guided`, `/app/settings`.
  - Pool: total assets $20.15, share price 1.0075, fees earned $0.15.
- **Worker:** keeper marked the 1-day invoice overdue, then defaulted it 30 contract days later. The reminders (T−1, D0, T+1, T+7) logged in order.
  - Pool after default: written off $1.46, share price 0.9345. The share-price chart showed the drop from 1.0075.
  - The buyer record showed score −12, frozen, rate 0%.
- **Bugs found and fixed:**
  - Server-side PDF parsing failed in the production build because pdfjs was bundled. It is now in `serverExternalPackages`.
  - On sandbox, the wallet selector raised a config error toast. Browser wallets are now disabled there with a clear message.
  - The receipt timeline did not show keeper steps. It now shows Overdue and Defaulted steps, with keeper tx links where they are known.

## Limits

- There is no block explorer for a local sandbox, so receipts show "Transaction link unavailable" even though hashes are recorded. On testnet the same hashes render as NearBlocks links.
- Browser wallets (MyNearWallet, Meteor, HOT) only work on testnet and mainnet. Use guided mode on sandbox.
- Seed execution still requires a sandbox/reviewer run; historical results above
  are not a claim that the new seed flow has been executed. All automated tests
  use mocked network behavior. See the completion summary for local check results.
