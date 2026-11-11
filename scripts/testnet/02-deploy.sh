#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"
require_live_cli

step 'Build both contracts with make build before deploying; review and pass tests first.'
# A preview must not build or write artifacts. A live run must complete the build.
run make -C "$REPO_DIR" build

find_wasm() {
    crate=$1
    contract=$2
    for base in "${CARGO_TARGET_DIR:-$REPO_DIR/target}" "$REPO_DIR/target" "$REPO_DIR/contracts/$contract/target"; do
        case "$base" in /*) ;; *) base=$REPO_DIR/$base ;; esac
        for file in "$base/near/$crate/$crate.wasm" "$base/near/$crate.wasm"; do
            if [ -s "$file" ]; then printf '%s\n' "$file"; return; fi
        done
    done
    if [ "$DRY_RUN" = 1 ]; then
        printf '%s/target/near/%s/%s.wasm\n' "$REPO_DIR" "$crate" "$crate"
    else
        echo "Missing $crate wasm after make build; stop and inspect build output." >&2
        return 1
    fi
}
USDC_WASM=$(find_wasm mock_usdc mock-usdc)
CORE_WASM=$(find_wasm tradewind tradewind)

step "Deploy testnet-only mock USDC to $USDC and initialize with new({})."
tx near contract deploy "$USDC" use-file "$USDC_WASM" with-init-call new json-args '{}' \
    prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
    network-config testnet sign-with-legacy-keychain send

step "Deploy core to $CORE with ROOT as owner and demo-default config (10 seconds/day)."
args=$(python3 - "$ROOT" "$TREASURY" "$USDC" "$ATTESTER" "$KEEPER" <<'PY'
import json, sys
print(json.dumps(dict(zip(('owner', 'treasury', 'usdc', 'attester', 'keeper'), sys.argv[1:])) | {'config': None}))
PY
)
tx near contract deploy "$CORE" use-file "$CORE_WASM" with-init-call new json-args "$args" \
    prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
    network-config testnet sign-with-legacy-keychain send

for account in "$CORE" "$TREASURY" "$EXPORTER" "$BUYER" "$BUYER2" "$LP"; do
    step "Register $account for tUSDC storage, paid by ROOT. Excess deposit is refunded."
    call "$USDC" storage_deposit "{\"account_id\":\"$account\",\"registration_only\":true}" \
        "$ROOT" '0.01 NEAR' '30 Tgas'
done
