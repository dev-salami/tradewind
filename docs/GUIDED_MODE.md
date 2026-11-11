# Guided mode: Play both sides

Guided mode is an unauthenticated **testnet/sandbox demo**. The server signs for
the sample exporter and buyer; visitors do not need a wallet. Never use real
funds, production keys, or real invoices with these endpoints.

## Configuration

Set `GUIDED_ENABLED=1` and supply `GUIDED_EXPORTER_ACCOUNT_ID`,
`GUIDED_EXPORTER_PRIVATE_KEY`, `GUIDED_BUYER_ACCOUNT_ID`, and
`GUIDED_BUYER_PRIVATE_KEY` using disposable, distinct demo accounts. Keep keys
server-side; there are no public key environment variables. Existing
`NEAR_NETWORK`, `NEAR_RPC_URL`, `CORE_CONTRACT_ID`, `USDC_CONTRACT_ID`, attester,
AI, and database settings still apply. Fund the demo accounts with test NEAR,
configure the existing attester on core, deploy **mock USDC**, register core and
exporter with that token, and provide pool liquidity. The faucet registers the
buyer when minting. `AI_MODE=mock` uses the existing explicitly marked mock
verification flow; live mode still requires a verified proof.

Every route returns **403 on mainnet**, before any other checks or side effects.
Disabled mode or missing guided keys returns **503**, with
`error: "guided mode not configured"`. Status follows these same refusal rules;
a successful status response has `available: true`. Missing attester settings
can fail invoice verification after creation; configure these before enabling.

## API

All endpoints are **POST**, require an `Origin` matching `PUBLIC_BASE_URL`
(or the request origin when unset), and accept `application/json`. No session
cookie is required. Responses are `Cache-Control: no-store`. Fields not listed
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
transaction arrays. Links target NearBlocks **testnet** (sandbox transactions
will not appear there). Retain returned invoice IDs instead of assuming the
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
buyer key; creation and advance use the exporter key. All target invoices must
belong to that pair. SAMPLE PDF generation duplicates the small fixture script
without changing it, matches requested face/tenor, hashes bytes before
verification, and erases the in-memory buffer even on failure. No PDF is stored.

## Operational boundaries

- One existing token bucket configured for 20 requests/minute/IP is shared by
  all five routes in each process; exhausted requests return 429. It refills
  continuously. A trusted ingress must replace `X-Forwarded-For`, not accept
  arbitrary client values. Absent IPs share a conservative `unknown` bucket.
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
Sandbox links target NearBlocks testnet but sandbox transactions are not indexed
there. Storage-blocking browsers can continue in memory without refresh recovery.

UI ordering, conversion, resume, visibility, partial errors and mocked RPC page
renders are covered by `guided-ui.test.tsx` and `rpc-pages.test.tsx`. Tests and
builds require the reviewer's Node-capable environment.

## Reviewer checks

`apps/web/tests/guided.test.ts` mocks near-api-js and prevents network fetches.
It covers every route's mainnet/config/origin guards, shared throttling,
validation, ownership, PDF/hash/verification, method arguments, gas/deposits,
minimum/dust payments, partial failures, and mutex release. Run the web test
suite and typecheck in a Node-capable review environment; neither was run in
the authoring environment.
