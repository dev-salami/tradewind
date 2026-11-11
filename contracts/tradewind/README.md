# Tradewind contract

One NEAR contract implements USDC invoice settlement, the LP vault and twPOOL
(NEP-141/145/148), and non-transferable invoice receipts (NEP-171 enumeration
with live metadata). Unreviewed and unaudited; intended for capped demo amounts.

## Build and test

With stable Rust, the `wasm32-unknown-unknown` target, and `cargo-near` installed:

```sh
# From the repository root:
cargo test --workspace
cargo fmt --all

# From contracts/tradewind:
cargo near build non-reproducible-wasm
```

The implementation environment has no Rust toolchain. These commands have not
been run there. Unit tests mock receipts and callback outcomes, not actual USDC
execution. Sandbox integration, gas measurement, and deployment are separate
review steps; this package does not deploy or contact an RPC.

## Methods

| Group | Methods |
|---|---|
| Initialize | `new(owner, treasury, usdc, attester, keeper, config)` |
| Invoice | `create_invoice`, `record_verification`, `cancel_invoice`, `accept_invoice`, `set_approver`, `request_advance` |
| Settlement | USDC `ft_transfer_call` → `ft_on_transfer`; `claim` |
| Pool | USDC `ft_transfer_call` with `{"action":"deposit"}`; `redeem` |
| Keepers (permissionless) | `mark_overdue`, `mark_default` |
| Admin | `set_config`, `set_roles`, `lp_allow`, `pause`, `unpause`, `unfreeze_buyer`, `attribute_unattributed`, `refund_unattributed`, `refund_overpaid`, `set_owner` |
| Invoice views | `get_invoice`, `list_invoices`, `invoices_by_exporter`, `invoices_by_buyer`, `preview_advance`, `now_contract_day`, `compute_terms_hash` |
| Other views | `get_buyer_record`, `get_pool`, `preview_deposit`, `preview_redeem`, `get_config`, `get_roles`, `get_claimable`, `list_unattributed`, `is_lp_allowed`, `get_approver` |
| twPOOL | `ft_transfer`, `ft_transfer_call`, `ft_total_supply`, `ft_balance_of`, `ft_metadata`, `storage_deposit`, `storage_withdraw`, `storage_unregister` |
| Invoice NFT | `nft_token`, `nft_metadata`, `nft_total_supply`, `nft_tokens`, `nft_supply_for_owner`, `nft_tokens_for_owner` |
| Disabled NFT operations | `nft_transfer`, `nft_transfer_call`, `nft_approve` always fail |
| Private callbacks | `on_advance_sent`, `on_payout`, `on_redeem`, `ft_resolve_transfer` |

Creation requires storage cost **plus 0.01 NEAR retained for minting**, with excess
refunded. Acceptance, approver changes, redemption, claiming, every admin method,
and standard token security-sensitive operations require one yoctoNEAR (standard
storage registration instead requires its storage deposit). Verification input
`v.at` may be omitted; it is always overwritten with block time.

Money and timestamps are JSON decimal strings (`U128` and `U64`); USDC and twPOOL
have six decimals. Tenor and configuration day counts are ordinary integers.
Statuses serialize as `Created`, `Accepted`, `AdvancePending`, etc.

Repayment message:

```json
{"action":"repay","invoice_id":"TW-0035","payment_ref":"settlement-reference"}
```

## Accounting and explicit choices

- `new`'s explicit `usdc` argument overrides `config.usdc`. The asset is immutable
  thereafter so config changes cannot strand existing liabilities.
- Config validation bounds rates and clock arithmetic. Changing
  `invoice_counter_start` later does not rewind the existing sequence. Accepted
  due dates and advanced financial terms are snapshots; keeper/grace thresholds
  and future scoring use current config, as specified.
- All multiplication/division uses U256. Fee amounts round up, payouts round
  down. Pool assets include only idle funds and outstanding principal, never
  protocol/exporter payouts, claims, stray funds, overpayments or write-offs.
- Unknown messages and invalid repayments are retained as unattributed funds.
  Repayment validation is performed before writes/promises; it returns zero
  unused tokens on business-rule errors. As with any contract, insufficient gas,
  exhausted storage balance, or runtime failure cannot be made panic-proof.
- Admin attribution uses the same validation but fails visibly instead of
  re-booking an invalid attribution. Failed admin refund transfers become
  claimable by the specified recipient; the original refund stays resolved.
- Repayment and default each have a separate once-only record flag. Recovery
  after default increments `recovered` without applying a second score penalty
  or reopening principal exposure. Small invoices do not change record counters
  except `accepted`.
- NFT ownership/enumeration use the standard library; metadata is synthesized
  from invoice state, never a stale stored copy. The requested contract metadata
  spec is `nft-2.0.0` (not the library's default `nft-1.0.0`).
- Paginated views default to 50 and cap at 100. Exporter/buyer index views return
  the full matching invoices. `preview_deposit` and `preview_redeem` return the
  computed output amount only; they do not promise allowlist/liquidity eligibility.
- String limits/truncation count Unicode characters; hashes require ASCII
  lowercase hexadecimal. Signing addresses are bounded to 200 characters and
  algorithm labels to 32 characters.
- Share registration on allowed deposits is sponsored by the contract. Share
  storage cannot be unregistered while a redemption is pending, preserving
  failed-redemption rollback. A contract NEAR buffer is required for storage and
  transfer deposits; keep the allowlist restricted.
- A direct USDC donation cannot change the share price: it is not accounted pool
  income. Do not send USDC with plain `ft_transfer`; use the messages above.
- There is no generic pool withdrawal. The owner and attester remain trusted;
  acceptance is not business identity verification and score gaming is not
  prevented. Pause leaves repayments, redemptions and keeper actions available.

Before a live review, register the contract and payout recipients on USDC and
check callback gas in a sandbox. Advance transfer failure rolls back collateral
and pool accounting; failed payout/refund pushes use `claimable` instead.
