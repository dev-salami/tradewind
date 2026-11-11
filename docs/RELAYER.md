# Trusted settlement relayer

Path A remains the default: 1Click delivers USDC to the core with
`customRecipientMsg` and `ft_on_transfer` books repayment. Path B sends to
`RELAYER_ACCOUNT_ID` without a custom message. The **Trusted settlement relayer**
holds funds in transit: this is custodial, not trustless settlement. The owner
must secure, fund, register and monitor that account. Provider SUCCESS means
delivery, not invoice repayment. Settlement is confirmed only when a finalized
invoice view contains `payments[].payment_ref === pid`.

## Worker configuration

Use an absolute `DATABASE_PATH` shared with the web app's `payment_intents` table.
The worker creates `relayer_forwards` idempotently. It skips signing in fixture
mode, when `SETTLEMENT_PATH` is not `B`, or when either relayer credential is
missing. Configure only through environment variables:

```dotenv
SETTLEMENT_PATH=B
RELAYER_ACCOUNT_ID=relayer.test.near
RELAYER_PRIVATE_KEY=
RELAYER_CONFIRM_TIMEOUT_MS=600000
RELAYER_MAINNET_OK=0
NEAR_NETWORK=sandbox
NEAR_RPC_URL=http://127.0.0.1:3039
CORE_CONTRACT_ID=core.test.near
USDC_CONTRACT_ID=usdc.test.near
DATABASE_PATH=/tmp/opencode/relayer.db
ONECLICK_SIMULATOR=1
ONECLICK_BASE_URL=http://127.0.0.1:4444
```

Supply the local sandbox key via the environment, never source control or a
`NEXT_PUBLIC_` variable. Worker signing uses only the `RELAYER_` credentials,
`USDC_CONTRACT_ID.ft_transfer_call`, 1 yoctoNEAR and 100 Tgas. The repay message is
`{"action":"repay","invoice_id":"…","payment_ref":"…"}` with
`receiver_id=CORE_CONTRACT_ID`. Storage-register the relayer and core on USDC
before delivery. Keep enough NEAR in the relayer for gas.

Mainnet signing is refused unless `NEAR_NETWORK=mainnet` and
`RELAYER_MAINNET_OK=1`. Setting that flag is **the owner's decision**, not a
recommendation or a safety certification. No mainnet calls or live quotes are
needed for development or tests. `ONECLICK_SIMULATOR=1` is always refused on
mainnet. The web simulator also refuses non-localhost upstreams.

## Reconciliation and failure policy

- Poll Path B intents for the configured network, refresh the invoice from chain,
  and use the pure `planForward` decision. Only SUCCESS and
  Accepted/Funded/PartiallyPaid/Defaulted invoices can forward.
- Use delivered `quote.amountOut`, capped to outstanding
  `face - (paid.total - paid.overpaid)`. Forward only the payable portion; **hold
  excess** in the relayer for manual review. A confirmed row can therefore still
  carry a reason recording held excess. Non-payable or missing invoices, invalid
  delivered amounts and zero balances are held; never automatically refunded.
- A SQLite transaction inserts a unique `planned` row **before signing**. Only
  the process that inserted it may send. After sending, store `sent` and the
  transaction hash. A subsequent tick marks `confirmed` only from chain evidence
  and copies the forwarding hash to `payment_intents.settled_tx`.
- A crash between claim and send is deliberately not automatically recoverable:
  both `planned` and `sent` wait until the confirmation timeout, then become
  `review`. A thrown send also becomes `review` because a lost RPC response may
  hide an already-broadcast transaction. Never auto-resend, even without a hash.
- INCOMPLETE_DEPOSIT requires refund review; REFUNDED/FAILED never forward.
  Pending ambiguous sends remain reconciliation-only. `held`, `review`, `failed`
  and missing chain evidence for a previously confirmed row cannot trigger a
  second send. The chain reference wins over local row state.
- Provider/RPC outages are logged per intent without signing or leaking keys.
  A claim is not a contract-side reservation: another payer can race a forward.
  On-chain accounting remains authoritative, and any contract-held overpayment
  requires the existing owner refund procedure.

The owner-only `/ops` **Relayer** panel lists recent state, base-unit-derived
amount, reason and forwarding explorer link. Its read-only endpoint additionally
requires an authenticated wallet session matching `get_roles().owner`; a client
wallet account alone is insufficient. It does not create or mutate tables.

For manual review, inspect finalized invoice payments, the FT receipts and
relayer USDC balance, the original quote, and the durable row/hash. Account for
held excess and returned FT amounts before deciding on a refund or an explicit
operator recovery. Back up the shared DB. Do not delete claims or resend on a
timer. There is intentionally no automatic refund or retry button.

## Local sandbox E2E (no web server)

Prerequisites: Node 22.23+, workspace dependencies, `near-sandbox` on PATH and
the core/mock USDC Wasm artifacts produced by `make build` (Rust/NEAR toolchain
required). These commands create only throwaway localhost accounts. Do not
reuse a validator home from another environment.

```sh
export PATH=/opt/node-v22.23.4/bin:$PATH
mkdir -p /tmp/opencode/relayer-sandbox
near-sandbox --home /tmp/opencode/relayer-sandbox init
near-sandbox --home /tmp/opencode/relayer-sandbox run --rpc-addr 127.0.0.1:3039
```

In a second terminal, from the repository root, once RPC is ready:

```sh
export PATH=/opt/node-v22.23.4/bin:$PATH
make build
node scripts/e2e-sandbox-setup.mjs /tmp/opencode/relayer-sandbox http://127.0.0.1:3039 /tmp/opencode/relayer-sandbox.env
node scripts/e2e-relayer.mjs /tmp/opencode/relayer-sandbox /tmp/opencode/relayer-sandbox.env
node scripts/e2e-relayer.mjs /tmp/opencode/relayer-sandbox /tmp/opencode/relayer-sandbox.env
```

The setup writes a mode-0600 local env file. The runner reads it, refuses any
non-localhost RPC or non-sandbox network, and creates `relayer.test.near` funded
by the throwaway `test.near` validator. Its generated local key is persisted in
that env file before account creation for resumability. It registers storage and
mints only the missing tUSDC. It creates/resumes a deterministic Accepted sample
invoice (or accepts an optional existing invoice ID as the third argument), calls
the core quote builder against an embedded fake server, persists the intent,
and runs the actual signed worker until chain-confirmed. No origin funds move.
For Accepted invoices, repayment goes to the exporter so pool idle can remain
unchanged; a Funded invoice exercises the pool waterfall.

Output prints before/after invoice payments and pool idle, the durable forwarding
row and its hash. The second run uses the same invoice/payment reference, sees
the existing chain payment, and does not mint or forward again. An uncertain
previous send remains review-only, not a retry. Do not rerun the non-idempotent
setup script against the same initialized accounts; rerun only the relayer runner.

To exercise the web simulator independently:

```sh
node scripts/fake-oneclick.mjs
```

Set `ONECLICK_SIMULATOR=1`, `ONECLICK_BASE_URL=http://127.0.0.1:4444` and the
sandbox settings above in the web/worker environments. In the RPC-backed web UI,
request a quote then use **Get deposit address** to persist a simulated intent.
Every quote/status response is labeled `simulated:true`. Never send funds to
`fake-deposit-…`. Local tUSDC delivery must be supplied separately (the E2E
runner does this); fake SUCCESS alone cannot settle an invoice.

The fake exposes `/v0/tokens`, `/v0/quote`, `/v0/deposit/submit` and
`/v0/status?depositAddress=…`. Defaults: PENDING_DEPOSIT → PROCESSING → SUCCESS
over three polls. `FAKE_ONECLICK_POLLS` changes the poll threshold;
`FAKE_ONECLICK_FORCE=REFUNDED|INCOMPLETE_DEPOSIT|FAILED` or a status query
`force=` chooses the terminal state. Optional `FAKE_ONECLICK_CALLBACK_URL` must
be localhost and receives one successful Path B delivery notification. It must
not initiate real funds movement. The default fake only reports `amountOut`.

## Automated checks

```sh
npm test
npm run typecheck
npm run lint
npm run build -w apps/web
```

Core table tests cover decisions, caps and no-resend timeouts. Worker tests use
in-memory SQLite and injectable fetch/forward, including concurrency, planned
claims, uncertain sends and confirmation. Web tests cover simulator refusal on
mainnet, fake intent persistence, truthful labels and owner-only read access.
