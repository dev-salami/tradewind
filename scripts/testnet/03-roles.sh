#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"
require_live_cli

step 'Print restricted-key commands for manual review only; these commands are NEVER executed by this script.'
step 'Keys belong to each role account; their allowed contract receiver is CORE. Replace public-key placeholders locally.'
for role in attester keeper bot; do
    case "$role" in
        attester) account=$ATTESTER; methods=record_verification; public_key='<ATTESTER_PUBLIC_KEY>' ;;
        keeper) account=$KEEPER; methods=mark_overdue,mark_default; public_key='<KEEPER_PUBLIC_KEY>' ;;
        bot) account=$BOT; methods=request_advance; public_key='<BOT_PUBLIC_KEY>' ;;
    esac
    print_command near account add-key "$account" grant-function-call-access \
        --allowance '0.1 NEAR' --contract-account-id "$CORE" --method-names "$methods" \
        use-manually-provided-public-key "$public_key" \
        network-config testnet sign-with-legacy-keychain send
done

step "Allow $LP to deposit into the pool (owner-signed, exactly one yoctoNEAR)."
call "$CORE" lp_allow "{\"account_id\":\"$LP\",\"allowed\":true}" "$ROOT" '1 yoctoNEAR' '30 Tgas'
require_event admin_action
step 'The bot still requires the exporter to opt in via set_approver; seed does not request advances.'
