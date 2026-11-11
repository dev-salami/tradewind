#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"
require_live_cli

step 'Seed testnet with mock tokens and MOCK verification, never real AI/TEE evidence. This is not rerun-safe.'
for account in "$LP" "$BUYER" "$BUYER2"; do
    amount=8000000
    if [ "$account" = "$LP" ]; then amount=20000000; fi
    step "Mint $amount tUSDC base units to $account (six decimals)."
    call "$USDC" mint "{\"account_id\":\"$account\",\"amount\":\"$amount\"}" "$ROOT" '0.01 NEAR' '30 Tgas'
done

step 'Deposit 20 tUSDC from the allowlisted LP into the core pool.'
call "$USDC" ft_transfer_call "{\"receiver_id\":\"$CORE\",\"amount\":\"20000000\",\"msg\":\"{\\\"action\\\":\\\"deposit\\\"}\"}" \
    "$LP" '1 yoctoNEAR' '150 Tgas'
require_event pool_deposit

for n in 1 2 3 4; do
    step "Create sample seed invoice $n of 4: 2 tUSDC, 60 contract days, no advance."
    # Hash deterministic SAMPLE content, not an actual document or AI response.
    doc_hash=$(printf 'SAMPLE testnet seed invoice %s' "$n" | python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())')
    args="{\"buyer\":\"$BUYER\",\"buyer_label\":\"Buyer (sample)\",\"invoice_number\":\"SEED-MOCK-$n\",\"face\":\"2000000\",\"tenor_days\":60,\"doc_hash\":\"$doc_hash\",\"terms_hash\":null}"
    call "$CORE" create_invoice "$args" "$EXPORTER" '0.1 NEAR' '100 Tgas'
    if [ "$DRY_RUN" = 1 ]; then
        id="<invoice-id-from-create-receipt-$n>"
        terms_hash="<terms-hash-from-create-receipt-$n>"
    else
        created=$(printf '%s\n' "$TX_OUTPUT" | python3 "$SCRIPT_DIR/receipt.py" invoice)
        id=$(printf '%s\n' "$created" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
        terms_hash=$(printf '%s\n' "$created" | python3 -c 'import json,sys; print(json.load(sys.stdin)["terms_hash"])')
    fi

    step "Record MOCK verification as $ATTESTER for $id. model_id=seed-mock; not a TEE attestation."
    args="{\"id\":\"$id\",\"v\":{\"verdict\":\"pass\",\"model_id\":\"seed-mock\",\"request_hash\":\"$doc_hash\",\"response_hash\":\"$doc_hash\",\"signature\":\"MOCK-NOT-A-TEE-SIGNATURE\",\"signing_address\":\"MOCK\",\"signing_algo\":\"mock\",\"chat_id\":\"seed-mock-$n\"}}"
    call "$CORE" record_verification "$args" "$ATTESTER" '0 NEAR' '50 Tgas'
    require_event invoice_verified

    step "Have the named buyer accept $id using the returned terms hash."
    call "$CORE" accept_invoice "{\"id\":\"$id\",\"terms_hash\":\"$terms_hash\"}" "$BUYER" '1 yoctoNEAR' '100 Tgas'
    require_event invoice_accepted

    step "Repay $id directly from BUYER on NEAR (Path C), with no advance and no protocol fee."
    args="{\"receiver_id\":\"$CORE\",\"amount\":\"2000000\",\"msg\":\"{\\\"action\\\":\\\"repay\\\",\\\"invoice_id\\\":\\\"$id\\\",\\\"payment_ref\\\":\\\"seed-mock-$n\\\"}\"}"
    call "$USDC" ft_transfer_call "$args" "$BUYER" '1 yoctoNEAR' '200 Tgas'
    require_event invoice_repaid
done
step 'Done. Four on-time seed repayments imply score 12 / rate 82%, not the spec example of score 10 / rate 80%.'
step 'Inspect buyer records, payout receipts and pool balances before using the demo. No cross-chain or AI service was called.'
