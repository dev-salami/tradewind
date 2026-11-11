# Any-chain invoice payment

## Safe defaults

The server never signs a payment, holds a buyer key, or sends tokens. It only
requests 1Click quotes, reports a buyer-provided deposit transaction hash, and
reads 1Click status plus finalized contract views. The buyer transfers funds
from their own origin-chain wallet. The NEAR option builds `ft_transfer_call`
for the buyer's wallet to approve (Path C).

All quotes default to `dry: true`, including client calls with `dry` omitted.
A real deposit address requires **all three**:

- `NEAR_NETWORK=mainnet`
- `ONECLICK_LIVE_QUOTES=1`
- An explicit **Get deposit address** click, sending `{live: true}` to the quote route.

The flag alone never makes previews live. `?dry=1` always forces a preview.
The UI also requires `NEXT_PUBLIC_DATA_SOURCE=rpc`; fixture screens never
offer live deposit addresses. Keep public network/contract settings aligned
with the server settings.
Testnet and sandbox force dry unless `ONECLICK_SIMULATOR=1` and
`ONECLICK_BASE_URL` points to an HTTP localhost fake server. This separate mode
allows an explicit `{live:true}` action to create a **simulated**, non-dry intent;
`?dry=1` still wins. It is refused on mainnet, skips the mainnet asset check,
and still checks recipient storage registration. Responses include
`simulated:true`; the UI shows **Simulated 1Click (local) · Trusted settlement
relayer**. Never send funds to a fake address: no real cross-chain funds move.
The older `/simulate` endpoint remains a six-second, no-write status preview.
Actual testnet repayment uses **Pay on NEAR (testnet USDC)**.

## What a mainnet live quote does

The quote route reads the invoice and `min_payment` from RPC, checks that the
amount is positive, no larger than `face - (paid.total - paid.overpaid)`, and
at least the minimum (except an exact final balance). Amounts in the API are
integer USDC base-unit strings, not display decimals. It validates the refund
address and resolves supported origin USDC assets from `/v0/tokens`; Ethereum
has no guessed asset ID and is resolved by `blockchain: eth` plus `symbol: USDC`.

With live enabled, it checks the destination is configured as mainnet USDC and
the recipient is storage-registered, then requests a **non-dry EXACT_OUTPUT**
1Click quote. This creates a real origin-chain deposit address, not a transfer.
The signed quote and UUID payment reference are persisted in SQLite. The UI
shows the address, required memo if any, address-only QR, input amount, deadline,
and signed-quote download. Instructions are retained in session storage across
reloads. The buyer must separately send the quoted amount from their own wallet
before the deadline, on the selected mainnet chain. Origin gas is additional;
the input includes swap costs and a 1% slippage buffer. Unused origin input is
refunded by 1Click to the validated refund address.

- `SETTLEMENT_PATH=A` (default): recipient is `CORE_CONTRACT_ID` and
  `customRecipientMsg` is the repay action, invoice ID and UUID payment reference.
  1Click's experimental NEAR withdrawal feature attempts `ft_transfer_call`
  when it processes the buyer's deposit. Missing storage or an incompatible
  `ft_on_transfer` can lose funds. Storage registration is checked, not performed,
  by this server. Mainnet use still needs independent approval and tiny-amount
  verification of the experimental path.
- `SETTLEMENT_PATH=B`: requires `RELAYER_ACCOUNT_ID`; recipient is the relayer,
  with no custom message. **Trusted settlement relayer** holds funds in transit.
  The worker durably claims each intent, forwards delivered USDC to the invoice
  contract, and reconciles its `payment_ref` on chain. Uncertain sends are never
  automatically repeated. SUCCESS alone is not proof of repayment. See
  [RELAYER.md](RELAYER.md) for the custody boundary, manual review and local E2E.

Other configuration: `CORE_CONTRACT_ID`, `USDC_CONTRACT_ID`, `NEAR_RPC_URL`,
`DATABASE_PATH`, optional `ONECLICK_BASE_URL` and `ONECLICK_JWT`. Only the worker
reads `RELAYER_PRIVATE_KEY`; the web server never signs or exposes this key.

## Routes and reconciliation

- `POST /api/pay/:id/quote`: `{originAsset, amount?, refundTo, live?}`. The
  origin asset is a preset asset ID; Ethereum may use `Ethereum` for server-side
  runtime resolution. Ten requests/minute/IP, same-origin required, no NEAR
  sign-in needed (anyone can repay). Configure ingress to overwrite
  `x-forwarded-for`; limits are process-local, not shared across replicas.
- `POST /api/pay/intents/:pid/deposit-tx`: `{txHash}`. The stored address and
  memo are used; the caller cannot redirect them.
- `GET /api/pay/intents/:pid/status`: 1Click status, transaction hashes and
  `settlement.confirmed`, true only for a contract payment
  whose `payment_ref` equals the intent UUID (the chain is authoritative). SUCCESS without that payment
  says awaiting invoice settlement, including on Path B.
- `GET /api/pay/:id/intents`: read-only reconciliation rows for this network.
  The SQLite `payment_intents` table additionally holds the full signed quote,
   refund address, `payment_ref`, and `settled_tx`. The forwarding worker writes
   its forwarding hash only after the chain payment appears; this server never invents one.
- `POST /api/pay/:id/simulate`: testnet/sandbox only; scripted statuses, no RPC,
  1Click, fund movement, or settlement writes. Refuses on mainnet.

Contract invoice detail and receipt views reuse `paymentSplits` from
`@tradewind/core` to replay each part's principal → pool fee → protocol →
exporter waterfall. They show net paid progress and the existing Partially paid
status. Overpaid units remain contract-held for manual owner refund, never
automatically returned to an Intents sender. Outstanding is checked at quote
time; concurrent payments can still race, so a quote does not reserve balance.

## Validation

Run `npm test`, `npm run typecheck`, `npm run lint`, and
`npm run build -w apps/web`. Tests use mocked fetch or a localhost fake, never
live quotes. The local sandbox E2E and exact commands are in [RELAYER.md](RELAYER.md).
