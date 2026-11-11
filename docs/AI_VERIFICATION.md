# AI verification foundation (brief 04)

Run with Node **22.13+** (tested on 22.23.4): `node:sqlite` / `DatabaseSync` is built in and may print an experimental-feature warning. No native SQLite dependency is needed. Run `npm install` after updating the dependency manifest; the root lockfile is deliberately unchanged for reviewer regeneration.

## Implemented live flow

- Public `/model/list` catalog, `modelId` parsing, explicit `metadata.verifiable === true`, ten-minute cache. If catalog retrieval is unavailable, only the three canonical IDs in `VERIFIABLE_MODELS` are permitted; an explicit negative catalog entry never falls back.
- Preflight `/attestation/report` with a fresh 32-byte nonce, canonical model, `provider=near`, `signing_algo=ecdsa`, no aliasing; reject empty/malformed model candidates or mismatched echoed nonces. Retain model signing identities and the nonce.
- Build the completion JSON once, UTF-8 SHA-256 that exact body, POST nonstreaming with no aliasing, JSON output, zero temperature and identity encoding. Read `arrayBuffer()` before parsing and hash those exact response bytes.
- Fetch `/signature/:chat_id?signing_algo=ecdsa`, retry only 404s with exponential backoff for at most 20 seconds (including HTTP timeout). A 2xx `error_code` is unavailable. Require `provider_tee`, exact `model:request_hash:response_hash`, EIP-191 recovery matching `signing_address`, and exactly one preflight model signer/algorithm match. Gateway signatures are rejected.
- Strict seven-check validation, independent six-decimal integer line-item-plus-tax arithmetic and on-chain face comparison, independent verdict computation. All checks pass → pass; only shipping/tampering failures → warn; other failures → fail. The model's own verdict is ignored.
- Function-call-key attester sends `record_verification` with `{id, v}`, 30 TGas, zero deposit. Restrict the deployed key to this method and contract. Missing keys return a typed 503 error, not an application crash. Only signature-checked live results or non-mainnet mocks may be attested. A verified **fail/warn** is recorded too (the contract rejects the invoice unless verdict is pass).

## Explicit TODOs and trust boundary

**TODO_VERIFY_TDX_QUOTES:** Full DCAP/TDX quote verification, quoted nonce/signer binding, event-log replay, GPU evidence, gateway/TLS binding, measurement allowlists and provenance policy are **not implemented**. `verified_ok` currently means the response-signature and raw preflight identity checks passed, **not** that hardware evidence has been cryptographically verified. A compromised preflight gateway remains a trust assumption. Do not market this as complete remote attestation or deploy it as a production trust boundary.

**TODO_E2EE:** Requests use ordinary HTTPS, not end-to-end encryption. The backend sees documents; the gateway may too. No `e2ee: true` flag is sent because plaintext with that flag would not implement encryption. Integrate an audited SDK/E2EE protocol before making gateway-blind privacy claims.

**TODO_VISION:** Scanned pages (including mixed scanned/text PDFs) return `scanned PDFs need the vision model` in both modes. `NEARAI_MODEL_VISION` is reserved; rendering/sending images is not implemented. The text path uses the legacy Node PDF.js build.

AI checks consistency, not real-world authenticity. The chain trusts the attester; it does not recover ECDSA signatures. The public receipt check verifies the published text and signer only, not hardware attestation, invoice authenticity, or the mapping from a document to the private request. On-chain document hashes can be compared with the exporter's retained document; request hashes alone do not prove its contents. Amounts and buyer accounts are public.

## Local demo / privacy

Without an API key the mode is mock. The deterministic mock recognizes the generated SAMPLE invoice format, not arbitrary invoices; it is labeled **MOCK — not a TEE result**, with `signature_kind: mock`, `mock: true`, and `verified_ok: false`. Mock results cannot be recorded on mainnet. Fixture receipts instead use a real EIP-191 signature from public Hardhat account #0, labeled **fixture**, never TEE. Reproduce the vector with `node scripts/make-fixture-proof.mjs`.

`node scripts/make-sample-invoice.mjs` generates correctly summed and rejected SAMPLE-watermarked PDFs in `apps/web/fixtures/` (ignored, no binaries committed). An optional output directory is accepted. Invoice TW-0042 is 10.00 USDC, cashew kernels W320, Net 60. Use buyer label `Gulf Foods Trading (sample)` and face 10.00 for a passing mock; missing/mismatched submitted fields fail checks. Preview checks are against fields submitted at upload, not subsequent edits; final verification re-runs against the on-chain invoice.

PDF files are ≤5 MiB with `%PDF-` magic. Multipart requests are bounded before parsing. PDFs are **never stored**; owned buffers are zeroed on completion/error (JavaScript/HTTP libraries can make temporary copies; secure process-memory erasure is not guaranteed). Drafts retain invoice/shipping **text**, extracted JSON, doc hash and exporter for one hour. Expired rows are purged on draft access/creation; deploy a periodic `DELETE FROM drafts WHERE expires_at <= <epoch milliseconds>` for idle-time retention enforcement. SQLite deletion is logical; protect the DB volume/backups. Public `/api/verify/:id` exposes hashes and signature text, **not document text or extracted fields**. No raw request/response bodies are persisted. Keep server secrets and DB volumes private.

Draft IDs are unguessable bearer capabilities. Wallet authentication and owner-bound sessions are a later brief; do not expose this MVP as an authenticated production API. The verify route binds the draft document hash to a Created on-chain invoice and uses on-chain fields, never client-supplied verification terms. Same-process invoice writes are serialized; deploy **one Node instance** until durable jobs/locking/idempotent transaction recovery are added. A network failure after broadcast can require transaction reconciliation; no automated rebroadcast is performed. The function-call key cannot create invoices, move funds or call owner methods.

Rate limit: ten uploads/minute/IP, in-memory token bucket. A trusted proxy **must overwrite** `x-forwarded-for`; do not trust arbitrary client forwarding headers. Multi-instance rate limiting, wallet authentication/CSRF, production resource quotas and durable retry jobs are outside this brief.

## Exact server environment

Empty values behave as unset. Nothing logs environment values.

| Variable | Default / purpose |
|---|---|
| `NEAR_NETWORK` | `testnet`; `testnet`, `sandbox`, `mainnet` |
| `NEAR_RPC_URL` | Network RPC: testnet/mainnet NEAR public RPC, sandbox `http://127.0.0.1:3030` |
| `CORE_CONTRACT_ID` | `core.tradewind-demo.testnet` |
| `USDC_CONTRACT_ID` | `sample-usdc.testnet` |
| `ATTESTER_ACCOUNT_ID` | Empty; required for writes |
| `ATTESTER_PRIVATE_KEY` | Empty; required for writes, restricted function-call key |
| `NEARAI_API_KEY` | Empty; required for live inference |
| `NEARAI_MODEL_TEXT` | `deepseek/deepseek-v3.2` |
| `NEARAI_MODEL_VISION` | `Qwen/Qwen3-VL-30B-A3B-Instruct` (reserved) |
| `NEARAI_BASE_URL` | `https://cloud-api.near.ai/v1` |
| `DATABASE_PATH` | `./data/tradewind.db`, relative to the running app's cwd |
| `SESSION_SECRET` | Empty; reserved for later wallet sessions |
| `PUBLIC_BASE_URL` | `http://localhost:3000` |
| `AI_MODE` | `live` or `mock`; inferred as `mock` without API key, `live` otherwise |

Existing browser config remains: `NEXT_PUBLIC_DATA_SOURCE=fixtures|rpc`, `NEXT_PUBLIC_NEAR_NETWORK`, `NEXT_PUBLIC_CORE_CONTRACT_ID`, `NEXT_PUBLIC_USDC_CONTRACT_ID`. Configure server and browser network/contract consistently. None of the private server variables should be prefixed `NEXT_PUBLIC_`.

## Routes

- `POST /api/invoices/draft`: multipart `file`, optional `shipping`, `form_fields` JSON (`fields` alias accepted). Fields: `exporter`, `buyer`, `buyer_label`, `invoice_number`, `face` in integer USDC micro-units, `tenor_days`, `currency`.
- `POST /api/invoices/:id/verify`: `{ "draft_id": "..." }`. Stores signature evidence even when unverified; only permitted results reach attester. Consumed drafts are deleted even if inference or attestation fails.
- `GET /api/verify/:id`: public raw signed payload/hashes/identity; no document contents.
- `GET /api/health`: network, contract, AI mode, null indexer height.

All routes return sanitized JSON errors without stack traces. The new-invoice UI computes `computeTermsHash` from editable terms and doc hash; creation remains disabled pending wallet connection.
