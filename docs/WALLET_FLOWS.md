# Wallet write flows

## Configuration

- `NEXT_PUBLIC_DATA_SOURCE=rpc` enables writes and contract reads. The default `fixtures` mode remains a read-only preview with the Sample data banner; it never signs transactions.
- Set `NEXT_PUBLIC_CORE_CONTRACT_ID` and `NEXT_PUBLIC_USDC_CONTRACT_ID` to the deployed contracts.
- `NEXT_PUBLIC_NEAR_NETWORK` accepts `testnet` (default), `mainnet`, or `sandbox`.
- Set `NEXT_PUBLIC_NEAR_RPC_URL` for a custom RPC, especially sandbox. Sandbox uses a custom wallet-selector network; individual wallets may not support local accounts or a local RPC. There is no sandbox explorer link.
- `NEXT_PUBLIC_APPROVER_ACCOUNT_ID` identifies the optional Telegram approver. Revocation works even if this variable is later removed.
- The verification service also accepts the corresponding server variables. If both server and public variables are set, they must identify the same network/contracts/RPC. Never put private keys in public variables.

SQLite stores display profiles in `accounts` and transaction notifications in `tx_log`, indexed by `invoice_id` when receipts or arguments reveal it. Neither table authorizes money movements. Display profiles are untrusted metadata, **not NEP-413 authenticated sessions**. Contract checks and wallet signatures authorize every write. NEP-413 authentication remains a separate security integration; do not treat a supplied profile account id as authenticated identity.

## Recovery and transaction handling

Wallet submissions show the hash and the network-specific NearBlocks link and notify `/api/tx/notify`. The notification persists the hash before looking up final receipts; an RPC outage leaves a pending row rather than losing the hash. No indexer is included.

MyNearWallet-style `transactionHashes` redirects are processed on load. The original signer is saved before opening the wallet. Failed receipts are not reported as successful. If final status is unavailable, inspect the hash before signing again. Refreshing a page with an unprocessed redirect retries its status lookup.

Invoice creation saves only draft metadata and the original exporter/network/contract in tab session storage, never PDF bytes. It reads `invoice_created` from receipt logs; after a redirect it can recover the newest invoice with the same document hash, excluding invoices that predated the submission. “Resume verification” does not sign another create. Drafts still expire after one hour. Discarding local recovery does not cancel an on-chain invoice. A failed/expired verification may require a new PDF check and manual recovery; an invoice already created must not be recreated blindly.

USDC registration obtains the exact NEP-145 `storage_balance_bounds.min`. Advance submission refreshes `preview_advance` and binds `expected_terms_hash` and `min_advance`. A failed advance callback is checked against the resulting invoice before showing funds as sent. Direct payments re-read outstanding and `min_payment` before signing; concurrent payments can still race, with excess handled by the contract's overpayment queue.

## Offline handoff / verification still required

No Node commands, installs, RPC calls, browser runs, or other network calls were executed for this brief. The wallet-selector packages were not present locally, so their READMEs and current release compatibility could not be checked under the no-network restriction. The manifest pins the five modules to `8.10.2`; these pins and the module APIs **require reviewer confirmation**, not a claim that they are the latest release.

The existing lockfile has intentionally not been fabricated. On a network-enabled review machine, check the package READMEs, confirm/update compatible exact pins, then run `npm install` to regenerate `package-lock.json` before using `npm ci`. Run:

```sh
npm run typecheck
npm test
npm run lint
npm run build
```

Browser checks: all three wallets, restored sessions/disconnect, wallet rejection, redirect success/failure/multiple hashes, create-and-verify recovery, storage registration before advance, callback failure, buyer account mismatch, partial/final direct payment, LP invitation gate/redeem liquidity failure, claim, and owner/non-owner ops. Use tiny funded testnet or sandbox accounts; no deploy or spend was performed here. Telegram linking and non-NEAR 1Click payments remain explicitly labeled placeholders.
