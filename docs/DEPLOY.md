# Testnet deployment and seed runbook

These scripts are **written, not deployed or run against a network**. They use
**near-cli-rs v0.31.x**, not the older JavaScript `near-cli`. They default to
`DRY_RUN=1`: previews print commands without calling `near`, building contracts,
creating accounts, generating keys, or writing environment files. Only an
explicit `DRY_RUN=0` enables execution. `03-roles.sh` always **prints** its
access-key commands, even in execution mode; only its LP allowlist call executes.

All scripts hard-refuse any `NETWORK` other than `testnet`, including an empty
value. ROOT must be a named `.testnet` account; all other accounts are derived
from it, never independently overridden. These are portable Bash scripts
(`set -euo pipefail`), not `/bin/sh` scripts. Run them with `bash`.

## 1. Prerequisites and review

- Existing, funded ROOT testnet account and its local legacy-keychain signing
  access. Account creation/faucet funding for ROOT is **not** automated.
- Bash, Python **3.9+**, `make`, Rust with `wasm32-unknown-unknown`, `cargo-near`,
  and near-cli-rs **0.31.x**. See the README for build prerequisites.
- Review contract code and complete `make test` before deploying. Building and
  testing can download dependencies or a sandbox binary if not cached; do not
  run them during an offline-only review. The deploy script runs `make build`
  in execution mode and stops on build failure or missing wasm.
- Budget at least **11 testnet NEAR plus gas/registration headroom** in ROOT.
  Creation allocates 5 to core (about 419 KB wasm needs about 4.2 NEAR locked
  for code alone), 3 to tUSDC, 1 to exporter, 0.5 each to buyer/LP, and 0.2
  each to treasury/attester/keeper/bot/buyer2. Inspect current wasm sizes and
  increase funding manually if necessary. Storage estimates are not guarantees.
- Keep credentials outside this repository. Account creation commands, **when
  explicitly run later**, generate keys into the CLI's local legacy keychain.
  Never copy those files into the repo or include private keys in command output.

CLI reference: [near-cli-rs v0.31.0 documentation/source](https://github.com/near/near-cli-rs/tree/v0.31.0).
No network access was used while authoring this runbook; neither the CLI nor
its documentation was available locally. Deploy/call/create command shapes use
the supplied v0.31 examples. **Before enabling execution**, verify the printed
commands against that release's documentation or local `--help`, especially
`account add-key … grant-function-call-access`, its allowance/method options,
and `use-manually-provided-public-key`. Do not substitute legacy `near deploy`,
`near call`, or `near create-account` syntax. Execution checks `near --version`
for 0.31.x, but that is not a substitute for syntax review.

## 2. Preview everything (no transactions)

From the repo root:

```bash
export ROOT=tradewind-demo.testnet  # replace with the existing funded account
export NETWORK=testnet
export DRY_RUN=1
bash scripts/testnet/env.sh
bash scripts/testnet/01-accounts.sh
bash scripts/testnet/02-deploy.sh
bash scripts/testnet/03-roles.sh
bash scripts/testnet/04-seed.sh
bash scripts/testnet/05-env-out.sh
```

Every numbered script sources `scripts/testnet/env.sh`. Derived accounts:

| Variable | Account |
| --- | --- |
| `CORE` | `core.$ROOT` |
| `USDC` | `tusdc.$ROOT` |
| `TREASURY` | `treasury.$ROOT` |
| `ATTESTER`, `KEEPER`, `BOT` | `attester.$ROOT`, `keeper.$ROOT`, `bot.$ROOT` |
| `EXPORTER`, `BUYER`, `BUYER2`, `LP` | `exporter.$ROOT`, `buyer.$ROOT`, `buyer2.$ROOT`, `lp.$ROOT` |

The seed preview shows placeholders for invoice IDs and terms hashes obtained
only after creation. It never queries chain state or fabricates transaction
hashes. Do not copy those placeholders into live commands: execute the script
only after reviewing it so it can obtain the real receipt values.

## 3. Create accounts (future, explicit execution)

Only after reviewing the preview and authorizing testnet activity:

```bash
DRY_RUN=0 bash scripts/testnet/01-accounts.sh
```

ROOT funds all sub-accounts using `account create-account fund-myself`. No
implicit account creation or fallback to mainnet is permitted. This script
does not skip existing accounts: if it stops partway through, inspect each
result and finish only the missing accounts using the reviewed preview commands.

## 4. Build, deploy, initialize, register

```bash
DRY_RUN=0 bash scripts/testnet/02-deploy.sh
```

This runs `make build`, resolves `mock_usdc.wasm` and `tradewind.wasm` using the
README's artifact layouts (including `CARGO_TARGET_DIR`), then deploys:

1. tUSDC with `new {}`. Its public mint faucet and six decimals are **testnet
   only**. Never deploy mock USDC on mainnet.
2. Core with `new(owner=ROOT, treasury=TREASURY, usdc=USDC,
   attester=ATTESTER, keeper=KEEPER, config=null)`. These are the actual Rust
   initializer arguments, including the roles omitted from the spec's summary.
   `config=null` selects demo defaults: 10 seconds/day, first sequence 35,
   70–85% rates, 1 tUSDC counted-face/min-payment, and 50 tUSDC maximum face.
3. `storage_deposit` on tUSDC for core, treasury, exporter, both buyers, and LP,
   paid by ROOT with 0.01 NEAR per call (excess refunded).

Initialization is for **fresh accounts/state only**. Do not rerun deploy-with-init
on an initialized contract. Stop on an error; inspect transaction and receipt
outcomes before doing anything else. No upgrade or migration is automated.

## 5. Role keys and LP permission

```bash
DRY_RUN=0 bash scripts/testnet/03-roles.sh
```

The script prints three manual add-key commands with public-key placeholders:

| Signing account (key owner) | Allowed receiver | Allowed methods |
| --- | --- | --- |
| `ATTESTER` | `CORE` | `record_verification` |
| `KEEPER` | `CORE` | `mark_overdue,mark_default` |
| `BOT` | `CORE` | `request_advance` |

Each command limits gas allowance to 0.1 NEAR. Generate service keys securely
outside the repo, replace only the public-key placeholders locally, review the
CLI syntax, and authorize those commands separately. Store private keys only
in the worker/API secret manager, not `.env` files committed to Git.

**“On core” means receiver-scoped, not key ownership.** A key owned by CORE
would call with CORE as predecessor; `record_verification` requires ATTESTER
as predecessor and would reject it. The named role accounts and their keys
therefore remain separate. The locally retained full-access account keys used
for setup are not worker credentials. Do not give workers the owner key or
those setup keys; use only the restricted service keys.

The script executes owner-signed `lp_allow(account_id=LP, allowed=true)` with
exactly one yoctoNEAR. The bot additionally needs exporter-signed
`set_approver(approver=BOT)` with one yoctoNEAR before an advance can be requested;
that opt-in is **not automated** here. No relayer is created (direct Path C only).

## 6. Seed mock testnet history

```bash
DRY_RUN=0 bash scripts/testnet/04-seed.sh
```

- Mint 20 tUSDC to LP and 8 each to BUYER and BUYER2. Values use six decimal
  base units; mint calls remain below the faucet's 1,000 tUSDC per-call cap.
- LP deposits 20 tUSDC with `ft_transfer_call` and `msg={"action":"deposit"}`.
- Create four **sample**, 2 tUSDC / 60-day invoices for BUYER from EXPORTER.
  Extract the returned invoice ID and terms hash from `invoice_created` logs;
  no counter or ID is assumed. Hashes cover explicitly sample content.
- ATTESTER calls `record_verification(id, v)` with
  **`"model_id":"seed-mock"`**, mock signature/address/algo/chat ID, and
  deterministic hashes. This is **not AI inference, signed evidence, or a TEE
  attestation**. Never label these receipts as a real NEAR AI check.
- BUYER accepts with exactly one yoctoNEAR, then repays each invoice directly
  through tUSDC `ft_transfer_call` with `action=repay`, `invoice_id`, and a
  sample `payment_ref`. No advance is requested: all repayment goes to exporter,
  no protocol/pool fee is earned, and seed pool share price should stay unchanged.

Each transaction's CLI output and hash are printed. `receipt.py` only parses
in-memory output offline; it does not call RPC or write logs. Missing hashes or
expected core events stop the script instead of silently treating refunded or
unattributed transfers as success. Receipt output-format changes can also stop
the parser **after a transaction has already succeeded**: inspect that hash and
chain state before resuming. Never blindly rerun seed: minting, deposits and
invoice creation are not idempotent. No resumable state file is maintained.

On a fresh deployment, four repayments completed within the demo's 600-second
invoice term yield **4 on time, 8 tUSDC volume, score 12, rate 82%**. This differs
from the spec's illustrative 3-on-time + 1-grace / score-10 / 80% record; this
script does not deliberately delay a payment or claim that example was run.
Keep signing prompts moving; late completion changes the real record honestly.
BUYER2 remains separate for a later default demo.

Before continuing, use the testnet explorer and contract views to check:
`get_roles`, `get_config`, `get_pool`, `get_buyer_record(account_id=BUYER)`,
`get_invoice(id)` for each created invoice, and USDC `ft_balance_of` for core,
LP, buyer and exporter. Expect 20 tUSDC idle, zero outstanding, 20 twPOOL minted,
four Repaid invoices and 8 tUSDC paid to exporter on a fresh run. Inspect callback
payout results and `get_claimable` too; a repayment event alone does not prove
every outgoing transfer succeeded. Preserve the printed hashes in operational
records outside this repository. Never invent explorer links or receipts.

## 7. Web app and worker environment

```bash
bash scripts/testnet/05-env-out.sh
```

Output contains public testnet account IDs, public client variables, and secret
variable **names only** aligned with `.env.example`. It never reads or outputs
keys. Review the output and configure the web/API and worker environments
separately. Do not pipe credentials into repo files. Path B relayer credentials
are intentionally unset. The RPC URL is printed, not contacted. Configure real
AI/Telegram/DB/session secrets separately; seed does not provision those services.
Keep testnet/mock labels visible; do not present mock seeds as real customers,
real underwriting, real cross-chain payments, or mainnet buyer history.

## Mainnet checklist — not automated

**requires the owner's explicit approval and funds — not automated**

These scripts cannot switch to mainnet. Use a separately reviewed manual
runbook after approval; never remove their testnet guard. From SPEC §13:

- [ ] Obtain explicit approval for each spend and confirm funding before any
  account creation, deployment, inference or payment. No automatic spending.
- [ ] Tiny Path A experiment: $1 cross-chain payment from Base via 1Click
  `customRecipientMsg` to a throwaway logging contract; verify receipt behavior.
  `dry:true` quote previews are free, but a payment is not. If Path A fails,
  explicitly review Path B custody, low-balance relayer and reconciliation.
- [ ] Deploy core and roles with reviewed ownership/config; use real six-decimal
  NEAR USDC `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`.
  Register USDC storage for all recipients; **never use/deploy the mock faucet**.
- [ ] Fund the allowlisted demo LP pool with **20 real USDC**; run four small
  **2 USDC** buyer-record invoices, repaid on NEAR directly (Path C). Record
  actual timing, scores and transaction hashes; do not assert a synthetic score.
- [ ] Run the full real-AI verification/acceptance/advance demo with 1Click from
  Base: one full payment, one payment split into two parts. Verify waterfall,
  payouts, buyer record, share price and public receipt links against chain data.
- [ ] Run the overdue/default path (spec's TW-0043 example) with a **different
  sample buyer** so the main buyer's history stays clean; use actual emitted IDs.
- [ ] Make judging testnet interactive and mainnet showcase read-only. Keep the
  hosted demo available through the judging period (spec target: 25 November).
- [ ] Approve budget using current prices. Spec estimates: code storage 4–6 NEAR,
  sub-accounts/storage buffers about 1 NEAR, gas under 1 NEAR, pool 20 USDC,
  seed circulation about 8 USDC, 1Click test + payments about 21 USDC plus fees
  and Base gas, Base wallet top-up about 25 USDC plus ETH gas. These overlap,
  not independent totals. Historical cash estimate: **$65–80 upfront**, roughly
  **$25–35 at risk**; most principal/storage recoverable, gas/fees not. Check
  actual balances, sizes and prices; no recovery is guaranteed.
- [ ] Confirm inference funding (spec estimates a $10 credit) and hosting,
  Telegram/domain availability (existing infrastructure estimated at $0).
- [ ] Use honest labels: “Demo pool seeded by the team”; sample entities and
  test wallets; “Record built from team test invoices on mainnet” **only for
  actual mainnet history**; “Demo clock: 1 contract day = 10 seconds”;
  “Illustrative pricing”; SAMPLE invoice watermark; underwriting/KYB “Roadmap”.
  “Checked by NEAR AI · private (TEE)” and “Real cross-chain payment” are allowed
  only for real verified inference and real cross-chain transactions respectively.
