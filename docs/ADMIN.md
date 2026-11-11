# Admin operations

Run from the repository root with Node 22+. CLI credentials come **only** from
`OWNER_ACCOUNT_ID` and `OWNER_PRIVATE_KEY`; keys are never logged, read from disk,
or sent to the browser. Set `CORE_CONTRACT_ID`, `NEAR_NETWORK` (`testnet` by
default; also `sandbox` or `mainnet`) and optionally `NEAR_RPC_URL`.

## CLI

Every mutation defaults to **dry-run**. Reads still query the configured RPC.
Only `--send` signs and broadcasts; mainnet additionally requires
`--i-understand-mainnet`. Supply secrets through your environment/secret manager,
not command arguments or committed files.

```sh
node scripts/admin.mjs status
node scripts/admin.mjs config get
node scripts/admin.mjs config set min_payment 2000000
node scripts/admin.mjs pause
node scripts/admin.mjs unpause --send
node scripts/admin.mjs buyer-limit buyer.testnet 12.50
node scripts/admin.mjs tee-signer list
node scripts/admin.mjs tee-signer add 0x1111111111111111111111111111111111111111
node scripts/admin.mjs tee-signer remove 0x1111111111111111111111111111111111111111
node scripts/admin.mjs cancel TW-0042
node scripts/admin.mjs keeper run TW-0042
# On mainnet, after reviewing the dry-run:
node scripts/admin.mjs pause --send --i-understand-mainnet
```

For `CORE_CONTRACT_ID=core.testnet`, `pause` prints:

```text
DRY-RUN account.functionCall({
  "contractId": "core.testnet",
  "methodName": "pause",
  "args": {},
  "attachedDeposit": "1",
  "gas": "30000000000000"
})
```

`buyer-limit buyer.testnet 12.50` prints:

```text
DRY-RUN account.functionCall({
  "contractId": "core.testnet",
  "methodName": "set_buyer_limit_override",
  "args": {
    "account_id": "buyer.testnet",
    "limit": "12500000"
  },
  "attachedDeposit": "1",
  "gas": "30000000000000"
})
```

Deposits and gas are decimal yoctoNEAR/gas strings (converted to BigInt for the
actual near-api-js call). Cancel and keeper calls attach zero; owner setters
attach one yoctoNEAR. Status includes config, roles, pool, paginated invoice
counts by status, and TEE signers when that view exists. Keeper uses final chain
time: mark default after the default deadline, otherwise mark overdue after due
time if not already overdue; no eligible action means no transaction.

Config updates call `set_config({ config })`, merging one changed key into the
latest full configuration. Amount fields use **integer USDC base units** (six
decimals), except `buyer-limit`, which accepts human USDC. Supported config keys:

```text
min_counted_face min_payment max_face base_buyer_limit
score_cap score_on_time score_grace score_late score_default
seconds_per_day fee_period_days base_rate_bps max_rate_bps rate_step_bps
pool_fee_bps_per_30d protocol_fee_bps grace_days default_after_days
limit_from_volume_bps max_single_advance_bps invoice_counter_start
paused require_tee_signature
```

The asset (`usdc`) is immutable. Numbers are range-checked, including contract
validation invariants; `invoice_counter_start` is limited to JavaScript's safe
integer range. Unknown commands/flags and unavailable views report the static
source-supported method list. This list is not deployment introspection: check
the deployed version before sending. Failed sends deliberately omit raw errors
to avoid leaking secrets; inspect chain receipts before retrying.

## Browser Operations

Open `/ops`, connect the CORE owner wallet, then **Sign in as owner** using
NEP-413. A connected wallet alone is insufficient: both the authenticated
session and connected account must match the current owner. The header Ops link
uses the same gate as the page. The owner is read from `get_config.owner`, or
`get_roles.owner` for the current contract schema. `OWNER_ACCOUNT_ID` supports
environments without a configured contract; configured live RPC failures deny
access rather than trusting a stale owner. Use matching server/client contract
and network environment settings.

Fixtures/demo hide Ops unless `NEXT_PUBLIC_SHOW_OPS=1`; even then the owner
session is required and fixtures remain read-only.

Editable settings are `min_payment` and `base_buyer_limit` (entered in USDC), plus
`seconds_per_day` **only on sandbox**. The contract has no reminder-days setting.
Preview shows the exact old/new base units and retains every other config field.
Mainnet requires an extra confirmation checkbox. Before signing, the app checks
the owner session again and re-reads config; concurrent changes require a fresh
preview. Only the browser wallet signs the `set_config` transaction. The server
never signs. Other Operations panels are retained. Local sandbox browser wallets
are not supported by the existing wallet provider; use the CLI there.

Tests (including CLI dry-run/argument building) run with `npm test`.
