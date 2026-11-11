# Tradewind

**Get paid today for invoices your buyers pay in 60 days.**

Tradewind is an invoice-advance protocol on NEAR: an exporter uploads an invoice, a private AI model in a NEAR AI Cloud TEE checks it, the buyer accepts it on-chain (minting the invoice as an NFT), a USDC pool advances 70–85% based on the buyer's on-chain repayment record, and the buyer later pays from any chain via NEAR Intents. The contract repays the pool first, then a small protocol fee, then the exporter.

> Work in progress for NEAR HACKATHON. See [`docs/SPEC.md`](docs/SPEC.md) and the build status in [`docs/CHECKLIST.md`](docs/CHECKLIST.md).

## Web foundation

The npm workspace contains `@tradewind/core` (pure TypeScript) and `@tradewind/web` (Next.js 16). With Node 22+, run `npm install`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run dev`. The web app defaults to clearly labelled sample fixtures; no wallet or payment operation is enabled.

See [`docs/WEB_FOUNDATION.md`](docs/WEB_FOUNDATION.md) for routes, datasource setup, reference UI reuse, reviewer notes, and contract integration assumptions.

Any-chain payment and partial-pay UX: [`docs/ONECLICK-PAY.md`](docs/ONECLICK-PAY.md).
Quotes are dry by default; real deposit addresses require mainnet,
`ONECLICK_LIVE_QUOTES=1`, and an explicit **Get deposit address** action.
The server never sends buyer funds. Testnet status simulation is labelled;
actual testnet repayment uses the buyer's NEAR wallet. Path B forwarding is
not implemented in this brief.

## Local sandbox

Testnet deployment and seed scripts (dry-run by default): [`docs/DEPLOY.md`](docs/DEPLOY.md).

Prerequisites: Rust (stable + `wasm32-unknown-unknown`), `cargo-near`, and `make`.
Linux also needs OpenSSL headers (`libssl-dev`) and normally `pkg-config`.
Without `pkg-config`, export `OPENSSL_LIB_DIR` and `OPENSSL_INCLUDE_DIR` to
the system OpenSSL library/header directories.

```sh
make build       # Both contracts; no deploy or public RPC calls
make unit        # Library unit tests only
make test        # Build wasm, then workspace unit + sandbox integration tests
make demo        # Build wasm and run the local Rust example
scripts/demo-local  # Same demo, from any working directory
npm run demo:local  # Optional npm convenience command; no npm install needed
make fmt
make clippy
```

The example and tests use only a local `near-workspaces` sandbox, with generated
local accounts and no credentials. The first run may download the sandbox
binary; pre-cache it if running offline. They never call a hosted AI service:
the local attester verdict is explicitly **MOCK**, not a TEE attestation.
The hosted application uses NEAR AI Cloud TEE.

Wasm is read from `target/near/<crate>.wasm` or
`target/near/<crate>/<crate>.wasm` (also checked under each contract's own
`target` directory and `CARGO_TARGET_DIR`). Missing artifacts produce a
`make build` instruction. Crate artifact names are `tradewind` and `mock_usdc`.
Run `make build` after contract edits; tests deliberately do not compile wasm.

The demo clock is **one contract day per second**. Tests use `fast_forward`,
not sleeps: overdue/default jumps use twice the deadline in days plus 10
blocks, then check `now_contract_day` actually crossed the deadline. Sandbox
blocks are assumed to advance timestamps approximately one second. The
three-day default invoice requests its advance immediately after acceptance.
Happy-path scoring uses four real on-time seed repayments (score 12, rate 82%),
then a $10/60-day invoice reaches score 15 and next rate 85%. The pool's
virtual +1 accounting yields exact share price `1.007499`, displayed rounded
as `1.0075` in the demo.

See [`contracts/mock-usdc/README.md`](contracts/mock-usdc/README.md):
testnet faucet token, never deploy to mainnet.

## License

MIT — see [LICENSE](LICENSE).
## AI verification foundation

See [AI verification setup and limitations](docs/AI_VERIFICATION.md) for exact environment variables, API usage, sample PDF generation, and the implemented live signature flow. **Full TDX quote verification, E2EE and scanned-PDF vision are still TODO.** Current live verification checks response signatures against preflight-reported identities, not fully verified hardware evidence. Mock and fixture results are explicitly labeled and are not TEE results. AI checks consistency, not invoice authenticity; the contract trusts the backend attester. Request hashes do not publicly prove document contents, and deal amounts/buyer accounts remain public.
