#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"
require_live_cli

step 'Create testnet sub-accounts using the existing funded ROOT. This is not rerun-safe.'
for account in "$CORE" "$USDC" "$TREASURY" "$ATTESTER" "$KEEPER" "$BOT" "$EXPORTER" "$BUYER" "$BUYER2" "$LP"; do
    amount=0.2
    case "$account" in
        "$CORE") amount=5 ;;
        "$USDC") amount=3 ;;
        "$EXPORTER") amount=5 ;;
        "$BUYER") amount=10 ;; # Guided root funds isolated 0.5 test NEAR session buyers.
        "$LP") amount=0.5 ;;
    esac
    step "Create $account with $amount testnet NEAR from $ROOT."
    run near account create-account fund-myself "$account" "$amount NEAR" \
        autogenerate-new-keypair save-to-legacy-keychain sign-as "$ROOT" \
        network-config testnet sign-with-legacy-keychain send
done
