# Tradewind build checklist

Source of truth: [`docs/SPEC.md`](SPEC.md). A box is ticked only after the work is **reviewed and merged into `main` with tests passing**. Each tick links the PR.

Network rule for this build: **testnet / local sandbox only**. Mainnet items stay unticked until the owner approves the spend.

## P0 — must ship

- [ ] **F1** Wallet connect and exporter onboarding (wallet selector, display name/country, USDC storage registration before first advance)
- [ ] **F2** Invoice creation + document upload (fields, browser SHA-256 doc hash, terms hash, `create_invoice` with storage deposit, face/max/buyer≠exporter guards) — _contract side merged (#1, #3); web/wallet flow pending_
- [ ] **F3** Private AI verification via NEAR AI Cloud (verifiable-model allowlist, `provider_tee` signature fetch + EIP-191 check, verdict recomputed server-side, attester writes `record_verification`; unverified blocks advance; mock fixtures when no key)
- [ ] **F4** Buyer review + on-chain acceptance (only named buyer, terms hash match, `due_at`) — _contract side merged (#1, #3); web/wallet flow pending_
- [x] **F5** Invoice NFT NEP-171 minted on acceptance (core + metadata + enumeration, `nft_mint` event, holder transfers disabled, moves to pool on advance, back on repay) — [#1](https://github.com/dev-salami/tradewind/pull/1), sandbox [#3](https://github.com/dev-salami/tradewind/pull/3)
- [ ] **F7a** USDC pool vault (deposit via `ft_transfer_call`, redeem up to idle, allowlist with refund) — _contract side merged (#1, #3); web/wallet flow pending_
- [ ] **F8** Advance from the pool (rate lock, fees, liquidity + exposure caps, `expected_terms_hash`/`min_advance` guards, revert callback on failed transfer) — _contract side merged (#1, #3); web/wallet flow pending_
- [x] **F10a** Overdue / default path on-chain (keeper `mark_overdue` / `mark_default`, write-off, freeze, events) — [#1](https://github.com/dev-salami/tradewind/pull/1), sandbox [#3](https://github.com/dev-salami/tradewind/pull/3)
- [ ] **F11** Any-chain buyer payment via NEAR Intents 1Click (EXACT_OUTPUT quote, `dry` preview, status polling, Path A `customRecipientMsg` / Path B relayer / Path C direct; **no mainnet spend**)
- [x] **F12** Repayment waterfall (pool principal → pool fee → protocol → exporter, claimable fallback, events, exact to 1e-6) — [#1](https://github.com/dev-salami/tradewind/pull/1), sandbox [#3](https://github.com/dev-salami/tradewind/pull/3)
- [ ] **F14** Public receipts `/r/:id` (timeline with tx links, AI proof + Verify, waterfall bars) — _read-only screen from fixtures (#2); tx links + Verify pending_
- [ ] **F15a** LP dashboard basic (pool totals, share price from contract view, funded invoices, position) — _read-only screen from fixtures (#2); RPC wiring pending_
- [ ] **F16** Demo clock, honest labels, testnet sandbox (+ guided "play both sides" on testnet only) — _banner/labels in #2; guided mode pending_
- [ ] **F17** Judge-ready repo (README "do X → see Y", MIT LICENSE, `make test`, `npm run demo:local`, libraries + reuse disclosure, no secrets) — _LICENSE, make test, demo:local merged (#3); judge README pending_
- [ ] **F18** Admin/ops console (owner-only page + CLI: pause, allowlist, config, attribute/refund, unfreeze, run keeper) — _contract side merged (#1, #3); web/wallet flow pending_

## P1 — approved additions

- [ ] **F6** Buyer track record + dynamic advance rate (contract scoring §6.5, exposure cap, `/buyer/:account` page, rate shown on invoice) — _contract scoring + caps merged (#1, #3); UI rate/buyer page from fixtures (#2), live wiring pending_
- [x] **F7b** twPOOL share token (NEP-141 on the core contract, virtual-share math §6.6, `ft_mint`/`ft_burn` events, metadata) — [#1](https://github.com/dev-salami/tradewind/pull/1), sandbox [#3](https://github.com/dev-salami/tradewind/pull/3)
- [ ] **F9** Telegram notifications + approve-advance card (deep-link linking, FrontDesk-style HTML cards, single-use 30-min callback tokens bound to terms hash + amount, approval log; runs on mocks until a bot token exists)
- [ ] **F10b** Buyer reminders delivery (T−7, T−1, D0, T+1, T+7 contract days, never repeated, Telegram or log)
- [ ] **F15b** LP share-price history (series from events, sparkline)

## P2 — last

- [ ] **F13** Partial payments UX (pay full / pay part, progress bar, per-part split list, per-part Telegram card). Contract support ships with F12. — _contract partial accounting merged (#1, #3); UX pending_

## Stretch (only if all above are done)

- [ ] **S1** Gasless buyer acceptance (NEP-366 meta-transaction relayer)
- [ ] **S2** CSV export of invoices and payments
- [ ] **S3** On-chain `ecrecover` check of the TEE signature against an allowlisted signing address

## Needs the owner (not code)

- [ ] Final name decision (§18.1)
- [ ] Spec sign-off incl. decisions D1–D16 (§19) — defaults are implemented as config constants
- [ ] Mainnet root + payout accounts, spend OK, NEAR AI key, Telegram bot token, Base buyer wallet
- [ ] "Make it public" for this repo
- [ ] X post + submission payload approval
