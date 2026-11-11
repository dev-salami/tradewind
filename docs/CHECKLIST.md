# Tradewind build checklist

Source of truth: [`docs/SPEC.md`](SPEC.md). A box is ticked only after the work is **reviewed and merged into `main` with tests passing**. Each tick links the PR.

Network rule for this build: **testnet / local sandbox only**. Mainnet items stay unticked until the owner approves the spend.

## P0 — must ship

End-to-end check on a local near-sandbox (real web app + worker + contracts; full happy path with partial payment and overdue → default path): [`docs/E2E_SANDBOX.md`](E2E_SANDBOX.md), [#15](https://github.com/dev-salami/tradewind/pull/15).

- [x] **F1** Wallet connect and exporter onboarding (wallet selector, display name/country, USDC storage registration before first advance) — _wallet flow merged ([#9](https://github.com/dev-salami/tradewind/pull/9)); not run against a live testnet deploy (no deploys)_
- [x] **F2** Invoice creation + document upload (fields, browser SHA-256 doc hash, terms hash, `create_invoice` with storage deposit, face/max/buyer≠exporter guards) — _wallet flow merged ([#9](https://github.com/dev-salami/tradewind/pull/9)); not run against a live testnet deploy (no deploys)_
- [x] **F3** Private AI verification via NEAR AI Cloud (verifiable-model allowlist, `provider_tee` signature fetch + EIP-191 check, verdict recomputed server-side, attester writes `record_verification`; unverified blocks advance; mock fixtures when no key) — [#5](https://github.com/dev-salami/tradewind/pull/5) (live NEAR AI path + mock until a key exists; TDX quote/E2EE TODOs documented); TDX/DCAP attestation verification on real recorded reports, ECDSA E2EE, vision path, chain-read Verify, single AI call [#23](https://github.com/dev-salami/tradewind/pull/23) (live path still needs a NEAR AI key)
- [x] **F4** Buyer review + on-chain acceptance (only named buyer, terms hash match, `due_at`) — _wallet flow merged ([#9](https://github.com/dev-salami/tradewind/pull/9)); not run against a live testnet deploy (no deploys)_
- [x] **F5** Invoice NFT NEP-171 minted on acceptance (core + metadata + enumeration, `nft_mint` event, holder transfers disabled, moves to pool on advance, back on repay) — [#1](https://github.com/dev-salami/tradewind/pull/1), sandbox [#3](https://github.com/dev-salami/tradewind/pull/3)
- [x] **F7a** USDC pool vault (deposit via `ft_transfer_call`, redeem up to idle, allowlist with refund) — _wallet flow merged ([#9](https://github.com/dev-salami/tradewind/pull/9)); not run against a live testnet deploy (no deploys)_
- [x] **F8** Advance from the pool (rate lock, fees, liquidity + exposure caps, `expected_terms_hash`/`min_advance` guards, revert callback on failed transfer) — _wallet flow merged ([#9](https://github.com/dev-salami/tradewind/pull/9)); not run against a live testnet deploy (no deploys)_
- [x] **F10a** Overdue / default path on-chain (keeper `mark_overdue` / `mark_default`, write-off, freeze, events) — [#1](https://github.com/dev-salami/tradewind/pull/1), sandbox [#3](https://github.com/dev-salami/tradewind/pull/3)
- [x] **F11** Any-chain buyer payment via NEAR Intents 1Click (EXACT_OUTPUT quote, `dry` preview, status polling, Path A `customRecipientMsg` / Path B relayer / Path C direct; **no mainnet spend**) — [#12](https://github.com/dev-salami/tradewind/pull/12) (Path C direct in #9). Testnet: dry preview quotes + labelled simulator; live deposit-address quotes gated to mainnet + `ONECLICK_LIVE_QUOTES=1` + explicit click, never exercised (no mainnet spend). Path B relayer forwarding job not built (Path A default)
- [x] **F12** Repayment waterfall (pool principal → pool fee → protocol → exporter, claimable fallback, events, exact to 1e-6) — [#1](https://github.com/dev-salami/tradewind/pull/1), sandbox [#3](https://github.com/dev-salami/tradewind/pull/3)
- [x] **F14** Public receipts `/r/:id` (timeline with tx links, AI proof + Verify, waterfall bars) — [#2](https://github.com/dev-salami/tradewind/pull/2) screen + Verify, [#12](https://github.com/dev-salami/tradewind/pull/12) split list, tx links [#14](https://github.com/dev-salami/tradewind/pull/14) (from wallet notify, attester, guided and worker receipts; no invented hashes); tx links read back from chain events [#21](https://github.com/dev-salami/tradewind/pull/21)
- [x] **F15a** LP dashboard basic (pool totals, share price from contract view, funded invoices, position) — [#2](https://github.com/dev-salami/tradewind/pull/2) screens, position + deposit/redeem [#9](https://github.com/dev-salami/tradewind/pull/9), RPC-mode render tests [#13](https://github.com/dev-salami/tradewind/pull/13); not run against a live testnet deploy
- [x] **F16** Demo clock, honest labels, testnet sandbox (+ guided "play both sides" on testnet only) — banner/labels [#2](https://github.com/dev-salami/tradewind/pull/2), guided backend [#10](https://github.com/dev-salami/tradewind/pull/10), guided UI [#13](https://github.com/dev-salami/tradewind/pull/13) (needs disposable testnet demo keys in env to run live); multi-judge-safe sessions + cleanup + seeded showcase, two simultaneous judges verified on sandbox [#22](https://github.com/dev-salami/tradewind/pull/22)
- [x] **F17** Judge-ready repo (README "do X → see Y", MIT LICENSE, `make test`, `npm run demo:local`, libraries + reuse disclosure, no secrets) — LICENSE + make test + demo:local [#3](https://github.com/dev-salami/tradewind/pull/3), judge README [#11](https://github.com/dev-salami/tradewind/pull/11); fresh clone verified (npm test/build, cargo build + 45 contract tests, local demo). Mainnet address + real-run tx links pending owner approval
- [x] **F18** Admin/ops console (owner-only page + CLI: pause, allowlist, config, attribute/refund, unfreeze, run keeper) — _wallet flow merged ([#9](https://github.com/dev-salami/tradewind/pull/9)); not run against a live testnet deploy (no deploys)_

## P1 — approved additions

- [x] **F6** Buyer track record + dynamic advance rate (contract scoring §6.5, exposure cap, `/buyer/:account` page, rate shown on invoice) — contract [#1](https://github.com/dev-salami/tradewind/pull/1)/[#3](https://github.com/dev-salami/tradewind/pull/3), buyer page + rate [#2](https://github.com/dev-salami/tradewind/pull/2), RPC-mode render tests [#13](https://github.com/dev-salami/tradewind/pull/13); not run against a live testnet deploy
- [x] **F7b** twPOOL share token (NEP-141 on the core contract, virtual-share math §6.6, `ft_mint`/`ft_burn` events, metadata) — [#1](https://github.com/dev-salami/tradewind/pull/1), sandbox [#3](https://github.com/dev-salami/tradewind/pull/3)
- [x] **F9** Telegram notifications + approve-advance card (deep-link linking, FrontDesk-style HTML cards, single-use 30-min callback tokens bound to terms hash + amount, approval log; runs on mocks until a bot token exists) — [#7](https://github.com/dev-salami/tradewind/pull/7) + NEP-413 sign-in [#8](https://github.com/dev-salami/tradewind/pull/8) (runs on in-app notifications until a bot token exists); local fake Bot API harness + token revocation on change [#20](https://github.com/dev-salami/tradewind/pull/20)
- [x] **F10b** Buyer reminders delivery (T−7, T−1, D0, T+1, T+7 contract days, never repeated, Telegram or log) — [#7](https://github.com/dev-salami/tradewind/pull/7)
- [x] **F15b** LP share-price history (series from events, sparkline) — [#7](https://github.com/dev-salami/tradewind/pull/7); chain-event backfill + 0/1-point chart [#21](https://github.com/dev-salami/tradewind/pull/21)

## P2 — last

- [x] **F13** Partial payments UX (pay full / pay part, progress bar, per-part split list, per-part Telegram card). Contract support ships with F12. — [#12](https://github.com/dev-salami/tradewind/pull/12) pay full / pay part, progress bar, split list; per-part Telegram card from worker (#7)

## Stretch (only if all above are done)

- [ ] **S1** Gasless buyer acceptance (NEP-366 meta-transaction relayer)
- [x] **S2** CSV export of invoices and payments — [#17](https://github.com/dev-salami/tradewind/pull/17) invoices + payments CSV (exact 6-dp amounts, formula-injection safe), dashboard links
- [x] **S3** On-chain `ecrecover` check of the TEE signature against an allowlisted signing address — contract allowlist + ecrecover [#19](https://github.com/dev-salami/tradewind/pull/19), mock public-test-key signatures [#23](https://github.com/dev-salami/tradewind/pull/23) (flag off by default; enable after allowlisting real TEE signers)

## Needs the owner (not code)

- [ ] Final name decision (§18.1)
- [ ] Spec sign-off incl. decisions D1–D16 (§19) — defaults are implemented as config constants
- [ ] Mainnet root + payout accounts, spend OK, NEAR AI key, Telegram bot token, Base buyer wallet
- [ ] "Make it public" for this repo
- [ ] X post + submission payload approval
