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
   - an LP.

   It then registers token storage, allowlists the LP, and deposits 20 tUSDC. The env file holds **local-sandbox-only** keys (mode 600). Never commit it.

4. Build and start the web app with that env. `NEXT_PUBLIC_*` values are baked in at build time:

   ```sh
   cd apps/web && set -a && . /tmp/tradewind-e2e.env && set +a
   export PUBLIC_BASE_URL=http://localhost:3312
   npm run build && npx next start -p 3312
   ```

5. Drive the loop through guided mode, either at `/app/guided` or with curl (`Origin: http://localhost:3312`):
   1. `POST /api/guided/invoice` → `accept` → `advance`;
   2. `pay` with `{"amount":"6000000"}`;
   3. `pay` again for the rest.

6. Start the worker with the same env: `cd apps/worker && npx tsx src/index.ts`.
   - It indexes invoices, snapshots the share price, sends T−7…T+7 reminders to the log, and runs the keeper.
   - For a 1-day test invoice, the keeper calls `mark_overdue` at the due date and `mark_default` after `default_after_days`. One day is 10 seconds on the demo clock.

## Result of the last run (2026-11-11)

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
