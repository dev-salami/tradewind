#!/usr/bin/env bash
set -euo pipefail

# Shared by the numbered scripts. No credentials are read or written here.
NETWORK=${NETWORK-testnet}
DRY_RUN=${DRY_RUN-1}
if [ "$NETWORK" != testnet ]; then
    echo 'Refusing to run: NETWORK must be testnet.' >&2
    exit 1
fi
case "$DRY_RUN" in
    0|1) ;;
    *) echo 'DRY_RUN must be 1 (preview) or explicitly 0 (execute).' >&2; exit 1 ;;
esac
: "${ROOT:?Set ROOT to an existing funded testnet account, e.g. tradewind-demo.testnet}"
case "$ROOT" in
    *.testnet) ;;
    *) echo 'ROOT must end in .testnet.' >&2; exit 1 ;;
esac
if [ "${#ROOT}" -gt 55 ] || ! printf '%s\n' "$ROOT" | LC_ALL=C grep -Eq '^[a-z0-9]+([._-][a-z0-9]+)*\.testnet$'; then
    echo 'ROOT must be a valid named account with room for the sub-account prefixes.' >&2
    exit 1
fi

CORE=core.$ROOT
USDC=tusdc.$ROOT
TREASURY=treasury.$ROOT
ATTESTER=attester.$ROOT
KEEPER=keeper.$ROOT
BOT=bot.$ROOT
EXPORTER=exporter.$ROOT
BUYER=buyer.$ROOT
BUYER2=buyer2.$ROOT
LP=lp.$ROOT
export NETWORK DRY_RUN ROOT CORE USDC TREASURY ATTESTER KEEPER BOT EXPORTER BUYER BUYER2 LP

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)

step() { printf '\n%s\n' "$*" >&2; }

# Single-quote every argument: previews can be reviewed/copied without eval.
print_command() {
    python3 - "$@" <<'PY'
import shlex, sys
print(' '.join(shlex.quote(arg) for arg in sys.argv[1:]))
PY
}

require_live_cli() {
    if [ "$DRY_RUN" = 0 ]; then
        command -v near >/dev/null 2>&1 || { echo 'Install near-cli-rs v0.31 first.' >&2; exit 1; }
        case "$(near --version)" in
            *' 0.31.'*) ;;
            *) echo 'Expected near-cli-rs v0.31.x; review CLI compatibility before proceeding.' >&2; exit 1 ;;
        esac
    fi
}

run() {
    print_command "$@"
    if [ "$DRY_RUN" = 0 ]; then
        "$@"
    fi
}

# Capture CLI output in memory only. near-cli-rs prints transaction IDs and
# NEP-297 receipt logs; do not invent hashes or continue without a receipt.
tx() {
    print_command "$@" >&2
    if [ "$DRY_RUN" = 1 ]; then
        TX_OUTPUT=
        printf 'Transaction hash: <available only after execution>\n'
        return
    fi
    if TX_OUTPUT=$("$@" 2>&1); then
        printf '%s\n' "$TX_OUTPUT"
    else
        printf '%s\n' "$TX_OUTPUT" >&2
        return 1
    fi
    printf '%s\n' "$TX_OUTPUT" | python3 "$SCRIPT_DIR/receipt.py" hash
}

call() {
    # contract, method, JSON, signer, deposit, gas
    tx near contract call-function as-transaction "$1" "$2" json-args "$3" \
        prepaid-gas "$6" attached-deposit "$5" sign-as "$4" \
        network-config testnet sign-with-legacy-keychain send
}

require_event() {
    if [ "$DRY_RUN" = 0 ]; then
        printf '%s\n' "$TX_OUTPUT" | python3 "$SCRIPT_DIR/receipt.py" event "$1"
    fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    step "Testnet environment ready for $ROOT (DRY_RUN=$DRY_RUN). No commands executed."
    printf 'CORE=%s\nUSDC=%s\nTREASURY=%s\nATTESTER=%s\nKEEPER=%s\nBOT=%s\nEXPORTER=%s\nBUYER=%s\nBUYER2=%s\nLP=%s\n' \
        "$CORE" "$USDC" "$TREASURY" "$ATTESTER" "$KEEPER" "$BOT" "$EXPORTER" "$BUYER" "$BUYER2" "$LP"
fi
