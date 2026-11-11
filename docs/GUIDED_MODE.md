# Guided mode: Play both sides

Guided mode is an unauthenticated **testnet/sandbox demo**. The server signs for
the sample exporter and a private per-browser-session buyer; visitors do not need a wallet. Never use real
funds, production keys, or real invoices with these endpoints.

## Configuration

Set `GUIDED_ENABLED=1` and supply `GUIDED_EXPORTER_ACCOUNT_ID`,
`GUIDED_EXPORTER_PRIVATE_KEY`, `GUIDED_BUYER_ACCOUNT_ID`, and
`GUIDED_BUYER_PRIVATE_KEY` using disposable, distinct demo accounts. Keep keys
server-side; there are no public key environment variables. Existing
`NEAR_NETWORK`, `NEAR_RPC_URL`, `CORE_CONTRACT_ID`, `USDC_CONTRACT_ID`, attester,
AI, and database settings still apply. Fund the demo accounts with test NEAR,
configure the existing attester on core, deploy **mock USDC**, register core and
exporter and buyer root with that token, and provide pool liquidity (the seed flow
deposits 1,000 tUSDC). Configure a stable `SESSION_SECRET` of at least 32 bytes,
shared by web and worker. `AI_MODE=mock` uses the existing explicitly marked mock
verification flow; live mode still requires a verified proof.

Every route returns **403 on mainnet**, before any other checks or side effects.
Disabled mode or missing guided keys returns **503**, with
`error: "guided mode not configured"`. Status follows these same refusal rules;
a successful status response has `available: true`. Missing attester settings
can fail invoice verification after creation; configure these before enabling.

## API

All endpoints are **POST**, require an `Origin` matching `PUBLIC_BASE_URL`
(or the request origin when unset), and accept `application/json`. No session
cookie is required for status or the first invoice. Creation sets a signed,
httpOnly, SameSite=Lax browser-session cookie `tw_guided` (Secure in production).
Subsequent accept/advance/pay calls require that cookie and check the session's
buyer on chain. Responses are `Cache-Control: no-store`. Fields not listed
below are rejected. USDC values are **integer strings in six-decimal minor
units**, never floating-point amounts.

| Endpoint | JSON body | Action |
| --- | --- | --- |
| `/api/guided/status` | `{}` | Availability, network, `exporter`, `buyer` |
| `/api/guided/invoice` | `{"face":"10000000","tenor_days":60}` (both optional) | Create SAMPLE invoice and verify/attest |
| `/api/guided/accept` | `{"invoice_id":"TW-0042"}` | Accept as buyer using current terms hash |
| `/api/guided/advance` | `{"invoice_id":"TW-0042"}` | Preview and request as exporter, minimum exactly preview.advance |
| `/api/guided/pay` | `{"invoice_id":"TW-0042","amount":"1000000"}` | Optional amount defaults to full outstanding; mint shortage then repay |

Invoice creation returns `{invoice_id, tx_hashes, tx_links, verdict, mock}`;
other mutations return `{invoice_id, tx_hashes, tx_links}`. Status includes empty
transaction arrays. Links use core's `explorerTx` for the configured network;
sandbox returns `tx_links: []`, retaining `tx_hashes`. The UI renders hashes as
code labelled **local sandbox · no explorer**. Retain returned invoice IDs instead of assuming the
fixture number is the generated on-chain ID. Tenor must be an integer 1–365;
face and payment amounts must be positive U128 strings, subject to core limits.

Payments require at least on-chain `min_payment`, except full outstanding dust.
Outstanding follows core's face minus paid total net of overpayment. Overpayment
and nonpayable statuses are rejected before minting. Faucet calls mint at most
1,000 tUSDC each, splitting larger shortfalls across calls. Keep core's demo
`max_face` small to bound faucet work. Existing sufficient balances are not minted again.
Repayment uses `ft_transfer_call` with 300 TGas, one yoctoNEAR, and
`{"action":"repay","invoice_id":"…","payment_ref":"guided:<uuid>"}`.

Creation attaches 0.1 test NEAR for storage and the NFT reserve (core refunds
excess); each mint attaches 0.00125 test NEAR for token storage. Acceptance
attaches one yoctoNEAR; advance attaches none. Acceptance and payment use the
session buyer key; creation and advance use the exporter key. All target invoices must
belong to that session buyer and exporter. Each session's first invoice provisions
`g<8 random hex>.<GUIDED_BUYER_ACCOUNT_ID>` with a fresh full-access key and
`GUIDED_BUYER_FUND_NEAR` test NEAR (default **0.5**), funded by the root buyer.
The server registers its mock USDC storage. Fund the root sufficiently for all
sessions; allow ten characters of account-name headroom (root at most 54).
Keys are stored only in SQLite `guided_sessions`, encrypted with AES-256-GCM
using a domain-separated SHA-256 key derived from `SESSION_SECRET`. Nonces and
authentication tags are stored with the ciphertext. Never log/export this table
or rotate the secret without preserving access to outstanding demo repayments.
Interrupted provisioning retains the encrypted key and can resume with the cookie.
`last_invoice_id` tracks the latest invoice; `guided_invoices` tracks every creation.
Invoice numbers are `G-<session's first 8 hex>-<incrementing counter>`, including
the SAMPLE PDF and verification form. Failed attempts may leave counter gaps.
The buyer label remains “Gulf Foods Trading (sample)”. SAMPLE PDF generation duplicates the small fixture script
without changing it, matches requested face/tenor, hashes bytes before
verification, and erases the in-memory buffer even on failure. No PDF is stored.

## Operational boundaries

- One existing token bucket configured for 20 requests/minute/IP is shared by
  all five routes in each process; exhausted requests return 429. It refills
  continuously. A trusted ingress must replace `X-Forwarded-For`, not accept
  arbitrary client values. Absent IPs share a conservative `unknown` bucket.
- New session provisioning has additional token buckets: **5/hour/IP** and
  **200/day globally** (continuous refill, process-local; restart resets limits).
  Exhaustion returns a clear 429. Existing sessions do not consume new-session
  tokens. Run one web signing process behind trusted ingress; distributed
  deployments need shared rate limits and signing coordination.
- Per-account in-process mutexes serialize guided signing, including guided
  attester calls. Run a single signing process or add distributed coordination
  before scaling; other endpoints/processes using the same keys are not covered.
- Each completed transaction and status access appends an `audit_log` entry
  with `actor: "guided"` in JSON detail. Verification uses the existing proof
  store and attester. Keys, PDF bytes, and raw RPC errors are not logged.
- Multi-transaction operations are not atomic or idempotent. On a later failure,
  JSON errors retain completed hashes and the invoice ID when known. Inspect
  chain state before retrying; successful transfer execution does not by itself
  guarantee core attributed the repayment (inspect invoice/payment events).
- Disable by unsetting `GUIDED_ENABLED`; never share these accounts with real
  users. The mainnet refusal is unconditional, not a UI-only safeguard.

## Abandoned demo cleanup

Run the worker against the **same absolute `DATABASE_PATH`**, `SESSION_SECRET`,
guided exporter key, network, core and mock USDC configuration. Optional
`OWNER_ACCOUNT_ID` / `OWNER_PRIVATE_KEY` support contract versions restricting
Accepted cancellation to the owner; keep that key worker-only. Before keeper
work, `guidedCleanup` finds invoices belonging to stored session buyers and the
guided exporter. At `GUIDED_STALE_MINUTES` (default **10 wall-clock minutes**):

- Created/Verified/Accepted without an advance cancel as exporter using
  `cancel_invoice` with no deposit. Explicit one-yocto rejections retry with one
  yocto; explicit owner-only rejections on Accepted may retry with the optional
  owner key. Ambiguous failures are not retried. Older contracts
  missing that method log `cancel_unavailable`
  and skip; other failures log `failed` without leaking RPC details.
- Funded/PartiallyPaid (or an already Defaulted legacy session) with an advance
  and an outstanding balance: mint only the shortfall and repay the full face
  outstanding from the encrypted session buyer key. Confirm Repaid on chain.
- Terminal states and AdvancePending are left alone. Every tracked session
  invoice is excluded from keeper defaulting, including when cleanup fails or
  the accelerated demo clock reaches default before ten wall-clock minutes.
  Disabling guided signing also retains this keeper exclusion.

Cancelling Accepted invoices requires the incoming contract support; the current
legacy method only cancels pre-acceptance invoices. Unsupported statuses log
`failed` and remain excluded from keeper defaulting. No buyer-limit override is
needed because each browser has independent exposure/freeze state. Monitor
cleanup failures and session NEAR balances. The worker and web still use separate
processes: do not run overlapping cleanup workers; simultaneous UI repayment can
race cleanup, so inspect receipts on failure rather than replaying blindly.

Ineligible guided advance returns **409** with
`{"error":"Not eligible: <preview.reason>"}`; the reason is preserved verbatim.
The wallet Advance panel also displays the preview reason and rechecks it before
submission.

## Showcase links

In RPC mode, `showcase()` validates `SHOWCASE_INVOICE_ID`/`SHOWCASE_BUYER` against
the chain; invalid or missing configuration falls back to the latest Repaid
invoice by creation time from paginated `listInvoices`. With no result (including
RPC unavailability), the landing renders **Run the demo → Play both sides**;
Receipts links to `/app/guided`, Buyers to `/pool`. Fixture mode alone retains
`TW-0042` / `gulf-foods-sample.testnet`. Seed with the sandbox setup or testnet
`06-showcase.sh` (dry-run by default; see `E2E_SANDBOX.md`).

## UI

`/app/guided` provides the **Play both sides** sample loop without a wallet.
The navigation link appears only after a successful JSON POST to status;
403/503 responses silently hide it. Mainnet renders neither the page controls
nor the link and does not request guided status.

Optional USD face and partial-payment inputs use the existing six-decimal
`parseAmount` conversion. Full payment leaves the amount to the backend.
Returned invoice IDs, local step progress, mock verdict labels and transaction
links are retained in session storage under `tw:guided:invoice`. Refresh resumes
the local guide, not an authoritative chain-state snapshot. A partial failure,
interrupted request, or non-pass verdict pauses the flow for inspection; starting
another sample clears only local progress and never undoes transactions. Check
the invoice/receipt for actual repayment attribution after a submitted payment.
Sandbox hashes have no explorer links. Storage-blocking browsers can continue in
memory without refresh recovery; cookie-blocking browsers cannot resume signing.

UI ordering, conversion, resume, visibility, partial errors and mocked RPC page
renders are covered by `guided-ui.test.tsx` and `rpc-pages.test.tsx`. Tests and
builds require Node 22 or newer.

## Reviewer checks

`apps/web/tests/guided.test.ts` mocks near-api-js and prevents network fetches.
It covers every route's mainnet/config/origin guards, shared throttling,
validation, ownership, PDF/hash/verification, method arguments, gas/deposits,
minimum/dust payments, partial failures, and mutex release. Run the web test
suite and typecheck in a Node-capable review environment. `guided-sessions.test.ts` adds cookie/tamper,
encryption, isolated provisioning, reuse, counters and session caps;
`showcase.test.ts` covers env/discovery/null resolution, and worker
`guided-cleanup.test.ts` covers fixture-based cleanup decisions and guarded
cancellation. `guided-near.test.ts` checks exporter cancellation, guarded
owner/deposit compatibility fallbacks, shortfall minting and full repayment confirmation.
All network behavior in these tests is mocked.
