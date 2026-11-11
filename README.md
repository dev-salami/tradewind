# Tradewind

**Get paid today for invoices your buyers pay in 60 days.**

Tradewind is an invoice-advance protocol on NEAR:

1. An exporter uploads an invoice. A private AI model running in a NEAR AI Cloud TEE checks it, and an attester writes the signed verdict on-chain.
2. The named buyer accepts the exact terms on-chain. Acceptance mints the invoice as a NEP-171 NFT.
3. A USDC pool advances 70–85% of face value, priced by the buyer's on-chain repayment record.
4. The buyer later pays from any chain via NEAR Intents 1Click (or directly in USDC on NEAR).
5. The contract runs a waterfall: pool principal → pool fee → protocol fee → exporter.

Spec: [`docs/SPEC.md`](docs/SPEC.md) · Build status: [`docs/CHECKLIST.md`](docs/CHECKLIST.md) · License: [MIT](LICENSE)

> **Network status.** Everything in this repo runs on a **local sandbox or NEAR testnet**. No mainnet contract is deployed yet, so there is no mainnet address or real-run tx link to show. Those will be added here once mainnet runs are approved.

---

## Quick start for judges — "do X → see Y"

Prerequisites: Node 22+ (uses built-in `node:sqlite`), **Rust ≥ 1.95** (tested on 1.99; older toolchains fail on current `serde_with`/near-sdk deps — `rustup update stable`) with `wasm32-unknown-unknown`, [`cargo-near`](https://github.com/near/cargo-near), `make`. On Linux you also need OpenSSL headers (`libssl-dev`) and `pkg-config`; without `pkg-config`, export `OPENSSL_LIB_DIR` / `OPENSSL_INCLUDE_DIR`.

| Do | See |
| --- | --- |
| `make test` | Contract unit tests (core + mock USDC) and `near-workspaces` sandbox integration tests all pass. No network or credentials needed (the first run downloads the sandbox binary). |
| `npm run demo:local` | The full loop on a local NEAR sandbox, printed step by step: seed pool → create invoice → MOCK attestation → buyer accepts (NFT minted) → advance at 82% (seeded score 12) → two partial repayments → waterfall split → score 15, next rate 85% → share price `1.0075` → LP redeems 20.15 USDC. |
| `npm install && npm test` | TypeScript tests for `@tradewind/core` (fee math, waterfall, rpc client, NEP-413, 1Click helpers), `@tradewind/web` (API routes, AI verification, auth, Telegram, guided mode) and `@tradewind/worker`. |
| `npm run build && npm run dev`, then open `http://localhost:3000` | The web app on clearly labelled **sample data** (read-only): landing page, exporter dashboard `/app`, invoice detail `/app/i/TW-0042`, buyer review `/b/TW-0042`, pay page `/pay/TW-0042`, public receipt `/r/TW-0042`, pool `/pool`, buyer record `/buyer/gulf-foods-sample.testnet`. |
| Click **Verify** on a receipt's AI document check | The proof panel. Sample proofs are labelled "Fixture — not a TEE result". Live proofs are checked in the browser (EIP-191 signer vs. the attested model key). |
| Set `NEXT_PUBLIC_DATA_SOURCE=rpc` plus the testnet contract ids in `.env` | The same screens reading live contract views over NEAR RPC, with wallet-signed actions (MyNearWallet / Meteor / HOT). |
| Set `GUIDED_ENABLED=1` plus disposable **testnet** demo keys, open `/app/guided` | "Play both sides" guided mode: the server signs as the sample exporter and buyer so you can run the loop without wallets. It is refused on mainnet. See [`docs/GUIDED_MODE.md`](docs/GUIDED_MODE.md). |
| Follow [`docs/E2E_SANDBOX.md`](docs/E2E_SANDBOX.md) | The real web app + worker against contracts on a **local** near-sandbox: guided invoice → accept → advance → part + final payment → waterfall; a 1-day invoice goes overdue → default → write-off → buyer frozen. |
| `scripts/testnet/*` (dry-run by default) | Prints the exact testnet deploy and seed commands it would run. See [`docs/DEPLOY.md`](docs/DEPLOY.md). |

No secrets are needed for any of the above. Without a NEAR AI key the app runs in explicitly labelled **mock** AI mode, which is refused on mainnet. Without a Telegram bot token, notifications stay in the in-app drawer.

---

## Repository layout

```
contracts/tradewind     Single Rust contract: NEP-171 invoice NFTs (transfers disabled), NEP-141 twPOOL
                        share token, USDC vault, advance + waterfall, buyer track record, keeper/admin
contracts/mock-usdc     Testnet faucet token (6 decimals). Never deploy to mainnet.
packages/core           @tradewind/core: pure TS types, fee/waterfall math, RPC datasource, fixtures, 1Click client
apps/web                @tradewind/web: Next.js 16 app + API routes (AI verify, attester, auth, Telegram, guided)
apps/worker             @tradewind/worker: keeper, buyer reminders, share-price snapshots
scripts/                demo-local, testnet scripts (dry-run default), sample invoice + fixture proof generators
docs/                   SPEC, CHECKLIST, per-feature notes
```

## How it works (one invoice, $10 face, 60-day terms)

1. **Create.** The browser hashes the PDF (SHA-256). The exporter signs `create_invoice`.
2. **AI check.** The server extracts the text and calls a *verifiable* model on NEAR AI Cloud. It fetches the `provider_tee` signature, checks the EIP-191 signer against the model's attestation report, recomputes the verdict server-side, and the attester calls `record_verification`. An unverified or failed check blocks the advance.
3. **Accept.** Only the named buyer can call `accept_invoice(id, terms_hash)`. This mints NFT `TW-…` and sets `due_at`.
4. **Advance.** `request_advance(id, expected_terms_hash, min_advance)` locks the rate from the buyer score (e.g. score 10 → 80%), checks liquidity and exposure caps, moves the NFT to the contract and sends $8.00 USDC. It reverts on a failed transfer.
5. **Repay.** The buyer pays in full or in parts:
   - via `ft_transfer_call` with `{"action":"repay"}`;
   - or from any chain through a 1Click EXACT_OUTPUT quote whose `customRecipientMsg` carries the same message.
   The waterfall is pool principal → pool fee → protocol fee → exporter. Each step is a claimable fallback, exact to 1e-6 USDC.
6. **Overdue / default.** Keeper calls mark overdue and default on contract days, write off the loss, and freeze the buyer. Reminders go out at T−7, T−1, D0, T+1 and T+7.
7. **LPs** deposit USDC for twPOOL shares (virtual-share math) and redeem up to idle liquidity.

All tunables (advance-rate bands, fees, caps, demo clock, minimum payment) are config values (spec decisions D1–D16), changeable by the owner.

The demo clock runs one contract day per second on the local sandbox. The hosted testnet setting is shown in the top banner.

## Honest limits

- AI checks **consistency** (does the PDF match the form?), not invoice authenticity. The contract trusts the backend attester's signature.
- Live TEE verification checks the response signature against the attested signing key. Full TDX quote verification, E2EE and scanned-PDF vision are TODO ([`docs/AI_VERIFICATION.md`](docs/AI_VERIFICATION.md)).
- 1Click is mainnet-only. On testnet the pay page shows dry (preview) quotes plus a labelled status simulator; real deposit addresses need mainnet, `ONECLICK_LIVE_QUOTES=1` and an explicit **Get deposit address** click. The server never moves buyer funds. Path A (`customRecipientMsg`) is the default; the Path B relayer forwarding job is not built. Details: [`docs/ONECLICK-PAY.md`](docs/ONECLICK-PAY.md).
- Deal amounts and accounts are public on-chain. Only the document hash goes on-chain, never the document.

## Libraries used

- **Contracts:** `near-sdk` 5.30, `near-contract-standards` 5.30 (NEP-141/145/171/177/181), `uint`; tests use `near-workspaces` 0.24, `tokio`, `serde_json`, `anyhow`. Built with `cargo-near`.
- **Web / core / worker:**
  - Next.js 16, React 19, Tailwind CSS 4, `lucide-react`;
  - `near-api-js` 5 and `@near-wallet-selector/*` 8 (MyNearWallet, Meteor, HOT);
  - `viem` (EIP-191 recovery), `@noble/curves` + `@noble/hashes` + `@scure/base` (NEP-413 sign-in), `zod`;
  - `pdfjs-dist` / `pdf-lib` (PDF text + sample invoices), `grammy` (Telegram), `qrcode`, `tsx`;
  - Node's built-in `node:sqlite`.
- **Tests:** `vitest`, Testing Library, `jsdom`.
- **Font:** Sora.

## Reuse disclosure

- **UI kit.** Card, KPI, Pill, DataTable, Select, toast and SVG chart components were adapted from a private dashboard project by the same team. They were renamed (`tw-*`), stripped of that project's domain, data and backend, and re-skinned with the Tradewind palette (green `#00C08B`, amber `#F5A524`, navy `#0B1F33`, off-white `#F6F4EF`) and the Sora font. Details: [`docs/WEB_FOUNDATION.md`](docs/WEB_FOUNDATION.md#reference-ui-reuse).
- **Telegram card style** follows an existing card template from the same team.
- **Token card, private-check badge, waterfall and chain-ring visuals** follow the team's own concept video.
- Everything else (contracts, protocol logic, APIs, worker) was written for this hackathon.

## AI tools disclosure

This repository was built with AI assistance: an AI coding agent (OpenCode) wrote most of the implementation from written feature briefs, and an AI tech-lead agent reviewed every change, compiled and tested it, made fixes, and merged it through pull requests. Product decisions and the spec were human-owned.

## Configuration

Copy `.env.example` to `.env`. All keys are optional for the local demo and tests. Never commit real keys. Feature notes:

- [`docs/AI_VERIFICATION.md`](docs/AI_VERIFICATION.md)
- [`docs/WALLET_FLOWS.md`](docs/WALLET_FLOWS.md)
- [`docs/TELEGRAM-WORKER.md`](docs/TELEGRAM-WORKER.md)
- [`docs/GUIDED_MODE.md`](docs/GUIDED_MODE.md)
- [`docs/ONECLICK-PAY.md`](docs/ONECLICK-PAY.md)
- [`docs/DEPLOY.md`](docs/DEPLOY.md)
- [`docs/WEB_FOUNDATION.md`](docs/WEB_FOUNDATION.md)

## Contract build and test details

```sh
make build       # Both contracts (cargo near build); no deploy or public RPC calls
make unit        # Library unit tests only
make test        # Build wasm, then unit + sandbox integration tests
make demo        # Build wasm and run the local example (same as npm run demo:local)
make fmt && make clippy
```

The tests use `fast_forward`, not sleeps, and check that `now_contract_day` really crossed each deadline.

Happy-path scoring uses four on-time seed repayments (score 12, rate 82%). A $10 / 60-day invoice then reaches score 15 (next rate 85%).

The pool's virtual +1 share accounting gives an exact share price of `1.007499`, displayed as `1.0075`.

Wasm is read from `target/near/<crate>.wasm` (or `target/near/<crate>/<crate>.wasm`). Run `make build` after editing a contract.

## License

MIT — see [LICENSE](LICENSE).
