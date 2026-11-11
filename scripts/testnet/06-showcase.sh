#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"
require_live_cli
step 'Fresh deployment only: run after 01..03 INSTEAD OF 04-seed. MOCK/test funds only. Not rerun-safe.'
step 'Default counter 35: four Gulf Foods repayments (35..38), three other-buyer repayments (39..41), showcase 42.'
GULF=gulf-foods.$ROOT
if [ "${#GULF}" -gt 64 ]; then echo 'ROOT is too long for the gulf-foods sub-account.' >&2; exit 1; fi
run near account create-account fund-myself "$GULF" '1 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as "$ROOT" network-config testnet sign-with-legacy-keychain send
call "$USDC" storage_deposit "{\"account_id\":\"$GULF\",\"registration_only\":true}" "$ROOT" '0.01 NEAR' '30 Tgas'
call "$USDC" mint "{\"account_id\":\"$LP\",\"amount\":\"1000000000\"}" "$ROOT" '0.01 NEAR' '30 Tgas'
call "$USDC" ft_transfer_call "{\"receiver_id\":\"$CORE\",\"amount\":\"1000000000\",\"msg\":\"{\\\"action\\\":\\\"deposit\\\"}\"}" "$LP" '1 yoctoNEAR' '150 Tgas'
require_event pool_deposit
for n in 1 2 3 4 5 6 7 8; do
    payer=$GULF; face=2000000; number=SEED-MOCK-$n
    if [ "$n" -gt 4 ] && [ "$n" -lt 8 ]; then payer=$BUYER2; fi
    if [ "$n" = 8 ]; then face=10000000; number=TW-0042; fi
    doc_hash=$(printf 'SAMPLE showcase %s' "$n" | python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())')
    call "$CORE" create_invoice "{\"buyer\":\"$payer\",\"buyer_label\":\"Gulf Foods Trading (sample)\",\"invoice_number\":\"$number\",\"face\":\"$face\",\"tenor_days\":60,\"doc_hash\":\"$doc_hash\",\"terms_hash\":null}" "$EXPORTER" '0.1 NEAR' '100 Tgas'
    if [ "$DRY_RUN" = 1 ]; then
        id="<invoice-id-$n>"; terms="<terms-hash-$n>"
    else
        created=$(printf '%s\n' "$TX_OUTPUT" | python3 "$SCRIPT_DIR/receipt.py" invoice)
        id=$(printf '%s\n' "$created" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
        terms=$(printf '%s\n' "$created" | python3 -c 'import json,sys; print(json.load(sys.stdin)["terms_hash"])')
    fi
    call "$CORE" record_verification "{\"id\":\"$id\",\"v\":{\"verdict\":\"pass\",\"model_id\":\"seed-mock\",\"request_hash\":\"$doc_hash\",\"response_hash\":\"$doc_hash\",\"signature\":\"MOCK-NOT-A-TEE-SIGNATURE\",\"signing_address\":\"MOCK\",\"signing_algo\":\"mock\",\"chat_id\":\"seed-$n\"}}" "$ATTESTER" '0 NEAR' '50 Tgas'
    call "$CORE" accept_invoice "{\"id\":\"$id\",\"terms_hash\":\"$terms\"}" "$payer" '1 yoctoNEAR' '100 Tgas'
    if [ "$n" = 8 ]; then
        # No slippage assumption: contract still checks eligibility and terms.
        call "$CORE" request_advance "{\"id\":\"$id\",\"expected_terms_hash\":\"$terms\",\"min_advance\":\"0\"}" "$EXPORTER" '0 NEAR' '100 Tgas'
        require_event advance_paid
    fi
    call "$USDC" mint "{\"account_id\":\"$payer\",\"amount\":\"$face\"}" "$ROOT" '0.01 NEAR' '30 Tgas'
    amounts=$face
    if [ "$n" = 8 ]; then amounts='6000000 4000000'; fi
    for amount in $amounts; do
        call "$USDC" ft_transfer_call "{\"receiver_id\":\"$CORE\",\"amount\":\"$amount\",\"msg\":\"{\\\"action\\\":\\\"repay\\\",\\\"invoice_id\\\":\\\"$id\\\",\\\"payment_ref\\\":\\\"showcase-$n-$amount\\\"}\"}" "$payer" '1 yoctoNEAR' '300 Tgas'
    done
    require_event invoice_repaid
done
step 'Append these non-secret values to the shared web/worker env file (actual returned ID, never assume counter state).'
printf 'SHOWCASE_INVOICE_ID=%s\nSHOWCASE_BUYER=%s\n' "$id" "$GULF"
ENV_FILE=${SHOWCASE_ENV_FILE:-tradewind-showcase.env}
step "Write showcase values to $ENV_FILE (only with DRY_RUN=0)."
run python3 -c 'import os,pathlib,sys
p=pathlib.Path(sys.argv[1]); values={"SHOWCASE_INVOICE_ID":sys.argv[2],"SHOWCASE_BUYER":sys.argv[3]}
lines=p.read_text().splitlines() if p.exists() else []
lines=[line for line in lines if line.split("=",1)[0] not in values]
fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,"w") as f: f.write("\n".join(lines+[k+"="+v for k,v in values.items()])+"\n")' "$ENV_FILE" "$id" "$GULF"
