#![allow(clippy::field_reassign_with_default)]
use crate::invoice::Verification;
use crate::*;
use near_contract_standards::{
    fungible_token::{core::FungibleTokenCore, receiver::FungibleTokenReceiver},
    storage_management::StorageManagement,
};
use near_sdk::serde_json::{json, Value};
use near_sdk::{
    test_utils::{get_created_receipts, get_logs, VMContextBuilder},
    testing_env, PromiseResult,
};
use std::panic::{catch_unwind, AssertUnwindSafe};

const START: u64 = 1_000_000_000;
const UNIT: u128 = 1_000_000;
fn account(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn context(caller: &str, deposit: u128, time: u64) -> near_sdk::VMContext {
    VMContextBuilder::new()
        .current_account_id(account("core.testnet"))
        .predecessor_account_id(account(caller))
        .signer_account_id(account(caller))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(time)
        .prepaid_gas(Gas::from_tgas(300))
        .account_balance(NearToken::from_near(100))
        .build()
}
fn call(caller: &str, deposit: u128, time: u64) {
    testing_env!(context(caller, deposit, time));
}
fn callback(success: bool, time: u64) {
    testing_env!(
        context("core.testnet", 0, time),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![if success {
            PromiseResult::Successful(b"null".to_vec())
        } else {
            PromiseResult::Failed
        }]
    );
}
fn fresh() -> Contract {
    call("owner.testnet", 0, START);
    // A test may initialize more than one scenario on the same thread.
    near_sdk::mock::with_mocked_blockchain(|b| {
        b.take_storage();
    });
    call("owner.testnet", 0, START);
    Contract::new(
        account("owner.testnet"),
        account("treasury.testnet"),
        account("usdc.testnet"),
        account("attester.testnet"),
        account("keeper.testnet"),
        None,
    )
}
fn received(c: &mut Contract, sender: &str, amount: u128, msg: Value, time: u64) -> u128 {
    call("usdc.testnet", 0, time);
    match c.ft_on_transfer(account(sender), U128(amount), msg.to_string()) {
        PromiseOrValue::Value(v) => v.0,
        _ => panic!("receiver must return a value"),
    }
}
fn repay(c: &mut Contract, id: &str, amount: u128, time: u64) {
    assert_eq!(
        received(
            c,
            "settlement.testnet",
            amount,
            json!({"action":"repay","invoice_id":id,"payment_ref":"sample-ref"}),
            time
        ),
        0
    );
}
fn seed_pool(c: &mut Contract) {
    call("owner.testnet", 1, START);
    c.lp_allow(account("lp.testnet"), true);
    assert_eq!(
        received(
            c,
            "lp.testnet",
            20 * UNIT,
            json!({"action":"deposit"}),
            START
        ),
        0
    );
}
fn create(c: &mut Contract, face: u128, tenor: u32) -> Invoice {
    call(
        "exporter.testnet",
        NearToken::from_near(1).as_yoctonear(),
        START,
    );
    c.create_invoice(
        account("buyer.testnet"),
        "Buyer (sample)".into(),
        "SAMPLE-1".into(),
        U128(face),
        tenor,
        "ab".repeat(32),
        None,
    )
}
fn verification(verdict: &str) -> Verification {
    Verification {
        verdict: verdict.into(),
        model_id: "verifiable-model".into(),
        request_hash: "ab".repeat(32),
        response_hash: "cd".repeat(32),
        signature: "sample-signature".into(),
        signing_address: "sample-signing-address".into(),
        signing_algo: "ecdsa".into(),
        chat_id: "sample-chat".into(),
        at: U64(0),
        signature_checked_on_chain: false,
    }
}
fn verify(c: &mut Contract, id: &str, verdict: &str) {
    call("attester.testnet", 0, START);
    c.record_verification(id.into(), verification(verdict));
}
fn accepted(c: &mut Contract) -> String {
    let i = create(c, 10 * UNIT, 60);
    verify(c, &i.id, "pass");
    call("buyer.testnet", 1, START);
    c.accept_invoice(i.id.clone(), i.terms_hash);
    i.id
}
fn funded(c: &mut Contract) -> String {
    seed_pool(c);
    let mut b = BuyerRecord::default();
    b.score = 10;
    c.buyers.insert(&account("buyer.testnet"), &b);
    let id = accepted(c);
    request(c, &id);
    callback(true, START);
    assert!(c.on_advance_sent(id.clone()));
    id
}
fn request(c: &mut Contract, id: &str) {
    call("exporter.testnet", 0, START);
    c.request_advance(id.into(), c.invoice(id).terms_hash, U128(0))
        .detach();
}
fn fails(f: impl FnOnce()) {
    assert!(catch_unwind(AssertUnwindSafe(f)).is_err());
}
fn event(name: &str) -> Value {
    get_logs()
        .into_iter()
        .filter_map(|s| {
            s.strip_prefix("EVENT_JSON:")
                .and_then(|v| near_sdk::serde_json::from_str::<Value>(v).ok())
        })
        .find(|v| v["standard"] == "tradewind" && v["event"] == name)
        .unwrap_or_else(|| panic!("missing event {name}"))
}
fn standard_event(standard: &str, name: &str) -> bool {
    get_logs()
        .iter()
        .filter_map(|s| {
            s.strip_prefix("EVENT_JSON:")
                .and_then(|v| near_sdk::serde_json::from_str::<Value>(v).ok())
        })
        .any(|v| v["standard"] == standard && v["event"] == name)
}

#[test]
fn full_happy_path_tokens_record_pool_and_events() {
    let mut c = fresh();
    seed_pool(&mut c);
    let mut b = BuyerRecord::default();
    b.score = 10;
    c.buyers.insert(&account("buyer.testnet"), &b);
    let id = accepted(&mut c);
    assert_eq!(id, "TW-0035");
    assert!(standard_event("nep171", "nft_mint"));
    assert_eq!(
        c.invoice(&id).terms_hash,
        "d11cff8fff67a62e4f17acfff1cf14190122a595be4572f17bd2ad0211e74980"
    );
    assert_eq!(
        c.nft_token(id.clone()).unwrap().owner_id,
        account("exporter.testnet")
    );
    assert_eq!(c.nft_total_supply(), U128(1));
    assert_eq!(
        c.nft_tokens_for_owner(account("exporter.testnet"), None, None)
            .len(),
        1
    );
    let p = c.preview_advance(id.clone());
    assert!(p.eligible);
    assert_eq!(p.advance, U128(8 * UNIT));
    request(&mut c, &id);
    assert!(standard_event("nep171", "nft_transfer"));
    assert_eq!(c.invoice(&id).status, InvoiceStatus::AdvancePending);
    assert_eq!(
        c.nft_token(id.clone()).unwrap().owner_id,
        account("core.testnet")
    );
    assert_eq!(
        (c.pool.idle.0, c.pool.outstanding_principal.0),
        (12 * UNIT, 8 * UNIT)
    );
    callback(true, START);
    assert!(c.on_advance_sent(id.clone()));
    assert_eq!(c.invoice(&id).status, InvoiceStatus::Funded);
    assert_eq!(event("advance_paid")["data"][0]["rate_bps"], 8000);
    repay(&mut c, &id, 10 * UNIT, START + 1);
    let i = c.invoice(&id);
    assert_eq!(i.status, InvoiceStatus::Repaid);
    assert_eq!(
        (
            i.paid.to_pool_principal.0,
            i.paid.to_pool_fee.0,
            i.paid.to_protocol.0,
            i.paid.to_exporter.0
        ),
        (8 * UNIT, 150_000, 50_000, 1_800_000)
    );
    assert_eq!(
        c.nft_token(id.clone()).unwrap().owner_id,
        account("exporter.testnet")
    );
    assert_eq!(
        (
            c.pool.idle.0,
            c.pool.outstanding_principal.0,
            c.pool.fees_earned.0,
            c.pool.protocol_fees_paid.0
        ),
        (20_150_000, 0, 150_000, 50_000)
    );
    assert_eq!(c.get_pool().share_price_e6.0, 1_007_499);
    let b = c.get_buyer_record(account("buyer.testnet"));
    assert_eq!(
        (b.record.score, b.rate_bps, b.record.open_principal.0),
        (13, 8300, 0)
    );
    assert_eq!(event("invoice_repaid")["data"][0]["outcome"], "on_time");
    let s = event("waterfall_split");
    assert_eq!(s["data"][0]["to_exporter"], "1800000");
    assert_eq!(s["data"][0]["to_pool_fee"], "150000");
    assert!(!get_created_receipts().is_empty());
    let metadata = c.nft_token(id).unwrap().metadata.unwrap();
    let extra: Value = near_sdk::serde_json::from_str(&metadata.extra.unwrap()).unwrap();
    assert_eq!(extra["status"], "Repaid");
    assert_eq!(c.nft_metadata().spec, "nft-2.0.0");
}

#[test]
fn partial_example() {
    let mut c = fresh();
    let id = funded(&mut c);
    repay(&mut c, &id, 6 * UNIT, START + 1);
    let i = c.invoice(&id);
    assert_eq!(i.status, InvoiceStatus::PartiallyPaid);
    assert_eq!(
        (
            i.paid.to_pool_principal.0,
            i.paid.to_pool_fee.0,
            i.paid.to_protocol.0,
            i.paid.to_exporter.0
        ),
        (6 * UNIT, 0, 0, 0)
    );
    assert_eq!(c.get_pool().share_price_e6.0, UNIT);
    assert_eq!(c.buyer(&account("buyer.testnet")).score, 10);
    repay(&mut c, &id, 4 * UNIT, START + 2);
    let s = event("waterfall_split");
    assert_eq!(s["data"][0]["to_pool_principal"], "2000000");
    assert_eq!(s["data"][0]["to_pool_fee"], "150000");
    assert_eq!(s["data"][0]["to_protocol"], "50000");
    assert_eq!(s["data"][0]["to_exporter"], "1800000");
    assert_eq!(c.invoice(&id).status, InvoiceStatus::Repaid);
}

#[test]
fn advance_failure_exact_revert_and_retry() {
    let mut c = fresh();
    seed_pool(&mut c);
    let id = accepted(&mut c);
    let old = c.get_pool();
    let open = c.buyer(&account("buyer.testnet")).open_principal;
    request(&mut c, &id);
    callback(false, START);
    assert!(!c.on_advance_sent(id.clone()));
    let i = c.invoice(&id);
    assert_eq!(i.status, InvoiceStatus::Accepted);
    assert!(i.advance.is_none());
    assert_eq!(c.nft_token(id.clone()).unwrap().owner_id, i.exporter);
    assert_eq!(
        (c.pool.idle, c.pool.outstanding_principal),
        (old.idle, old.outstanding_principal)
    );
    assert_eq!(c.buyer(&i.buyer).open_principal, open);
    event("advance_reverted");
    request(&mut c, &id);
    callback(true, START);
    assert!(c.on_advance_sent(id));
}

#[test]
fn double_advance_and_pending_payment_are_blocked() {
    let mut c = fresh();
    seed_pool(&mut c);
    let id = accepted(&mut c);
    request(&mut c, &id);
    fails(|| request(&mut c, &id));
    repay(&mut c, &id, 10 * UNIT, START);
    assert_eq!(c.unattributed.len(), 1);
    assert_eq!(c.invoice(&id).status, InvoiceStatus::AdvancePending);
}

#[test]
fn never_advanced_partial_and_full_payment() {
    let mut c = fresh();
    let id = accepted(&mut c);
    repay(&mut c, &id, 6 * UNIT, START);
    assert_eq!(c.invoice(&id).paid.to_exporter.0, 6 * UNIT);
    assert_eq!(c.invoice(&id).status, InvoiceStatus::PartiallyPaid);
    fails(|| request(&mut c, &id));
    repay(&mut c, &id, 4 * UNIT, START);
    let i = c.invoice(&id);
    assert_eq!(i.paid.to_exporter.0, 10 * UNIT);
    assert_eq!((i.paid.to_protocol.0, c.pool.idle.0), (0, 0));
    assert_eq!(i.status, InvoiceStatus::Repaid);
    assert_eq!(c.buyer(&i.buyer).score, 3);
}

#[test]
fn nonpayable_statuses_unknown_and_malformed_are_retained() {
    let mut c = fresh();
    let created = create(&mut c, 10 * UNIT, 60);
    repay(&mut c, &created.id, UNIT, START);
    verify(&mut c, &created.id, "pass");
    repay(&mut c, &created.id, UNIT, START);
    let rejected = create(&mut c, 10 * UNIT, 60);
    verify(&mut c, &rejected.id, "warn");
    repay(&mut c, &rejected.id, UNIT, START);
    let cancelled = create(&mut c, 10 * UNIT, 60);
    call("exporter.testnet", 0, START);
    c.cancel_invoice(cancelled.id.clone());
    repay(&mut c, &cancelled.id, UNIT, START);
    repay(&mut c, "TW-9999", UNIT, START);
    assert_eq!(
        received(
            &mut c,
            "settlement.testnet",
            UNIT,
            json!({"action":"repay"}),
            START
        ),
        0
    );
    call("usdc.testnet", 0, START);
    assert!(matches!(
        c.ft_on_transfer(account("settlement.testnet"), U128(UNIT), "bad json".into()),
        PromiseOrValue::Value(U128(0))
    ));
    assert_eq!(c.unattributed.len(), 7);
    assert_eq!(c.invoice(&created.id).paid.total.0, 0);
    event("unattributed_payment");
}

#[test]
fn overpayment_refunds_and_record_only_once() {
    let mut c = fresh();
    let id = funded(&mut c);
    repay(&mut c, &id, 12 * UNIT, START);
    assert_eq!(c.invoice(&id).paid.overpaid.0, 2 * UNIT);
    repay(&mut c, &id, UNIT, START);
    assert_eq!(c.invoice(&id).paid.overpaid.0, 3 * UNIT);
    assert_eq!(c.buyer(&account("buyer.testnet")).score, 13);
    call("owner.testnet", 1, START);
    c.refund_overpaid(id.clone(), account("refund.testnet"), U128(2 * UNIT));
    assert_eq!(c.invoice(&id).overpaid_refunded.0, 2 * UNIT);
    fails(|| c.refund_overpaid(id.clone(), account("refund.testnet"), U128(2 * UNIT)));
    callback(false, START);
    c.on_payout(account("refund.testnet"), U128(2 * UNIT));
    assert_eq!(c.get_claimable(account("refund.testnet")).0, 2 * UNIT);
}

#[test]
fn default_partial_recovery_and_frozen_record() {
    let mut c = fresh();
    let id = funded(&mut c);
    repay(&mut c, &id, 6 * UNIT, START);
    let due = c.invoice(&id).due_at.unwrap().0;
    let time = due + u64::from(c.config.default_after_days) * c.config.day_ns() + 1;
    call("anyone.testnet", 0, time);
    c.mark_default(id.clone());
    assert_eq!(
        (
            c.pool.outstanding_principal.0,
            c.pool.written_off.0,
            c.pool.idle.0
        ),
        (0, 2 * UNIT, 18 * UNIT)
    );
    let b = c.buyer(&account("buyer.testnet"));
    assert_eq!(
        (b.score, b.defaulted, b.open_principal.0, b.frozen),
        (-5, 1, 0, true)
    );
    assert_eq!(
        event("invoice_defaulted")["data"][0]["written_off"],
        "2000000"
    );
    repay(&mut c, &id, UNIT, time + 1);
    assert_eq!(c.invoice(&id).status, InvoiceStatus::Defaulted);
    assert_eq!(c.pool.written_off.0, UNIT);
    repay(&mut c, &id, 3 * UNIT, time + 2);
    assert_eq!((c.pool.written_off.0, c.pool.idle.0), (0, 20_150_000));
    let b = c.buyer(&account("buyer.testnet"));
    assert_eq!(
        (b.recovered, b.score, b.frozen, b.repaid_volume.0),
        (1, -5, true, 10 * UNIT)
    );
    assert_eq!(
        event("invoice_repaid")["data"][0]["outcome"],
        "after_default"
    );
    assert_eq!(c.get_buyer_record(account("buyer.testnet")).rate_bps, 0);
}

#[test]
fn grace_and_late_use_final_payment_time() {
    let mut c = fresh();
    let id = accepted(&mut c);
    let due = c.invoice(&id).due_at.unwrap().0;
    call("anyone.testnet", 0, due + 1);
    c.mark_overdue(id.clone());
    repay(&mut c, &id, 9 * UNIT, due + 1);
    assert!(c.invoice(&id).overdue);
    let grace_end = due + 7 * c.config.day_ns();
    repay(&mut c, &id, UNIT, grace_end);
    assert!(!c.invoice(&id).overdue);
    assert_eq!(c.buyer(&account("buyer.testnet")).score, 1);
    assert_eq!(event("invoice_repaid")["data"][0]["outcome"], "grace");
    let next = accepted(&mut c);
    let due = c.invoice(&next).due_at.unwrap().0;
    let time = due + 7 * c.config.day_ns() + 1;
    repay(&mut c, &next, 10 * UNIT, time);
    assert_eq!(c.buyer(&account("buyer.testnet")).score, -2);
    assert_eq!(event("invoice_repaid")["data"][0]["outcome"], "late");
}

#[test]
fn min_payment_final_dust_and_payment_cap() {
    let mut c = fresh();
    let id = accepted(&mut c);
    repay(&mut c, &id, UNIT - 1, START);
    assert_eq!(c.unattributed.len(), 1);
    assert_eq!(c.invoice(&id).paid.total.0, 0);
    repay(&mut c, &id, 9_500_000, START);
    repay(&mut c, &id, 500_000, START);
    assert_eq!(c.invoice(&id).status, InvoiceStatus::Repaid);
    let mut i = c.invoice(&id);
    while i.payments.len() < config::MAX_PAYMENTS {
        i.payments.push(i.payments[0].clone());
    }
    c.invoices.insert(&id, &i);
    repay(&mut c, &id, UNIT, START);
    assert_eq!(c.unattributed.len(), 2);
}

#[test]
fn small_invoices_do_not_score_even_on_default_recovery() {
    let mut c = fresh();
    let i = create(&mut c, UNIT - 1, 1);
    verify(&mut c, &i.id, "pass");
    call("buyer.testnet", 1, START);
    c.accept_invoice(i.id.clone(), i.terms_hash);
    let time = c.invoice(&i.id).due_at.unwrap().0 + 31 * c.config.day_ns();
    call("anyone.testnet", 0, time);
    c.mark_default(i.id.clone());
    repay(&mut c, &i.id, UNIT - 1, time);
    let b = c.buyer(&account("buyer.testnet"));
    assert_eq!(
        (
            b.accepted,
            b.defaulted,
            b.recovered,
            b.repaid_volume.0,
            b.score,
            b.frozen
        ),
        (1, 0, 0, 0, 0, false)
    );
}

#[test]
fn limits_preview_stale_terms_and_opted_in_approver() {
    let mut c = fresh();
    let id = accepted(&mut c);
    assert_eq!(
        c.preview_advance(id.clone()).reason.as_deref(),
        Some("pool idle liquidity too low")
    );
    seed_pool(&mut c);
    let hash = c.invoice(&id).terms_hash;
    call("exporter.testnet", 0, START);
    fails(|| {
        c.request_advance(id.clone(), "wrong".into(), U128(0))
            .detach();
    });
    fails(|| {
        c.request_advance(id.clone(), hash.clone(), U128(8 * UNIT))
            .detach();
    });
    call("unapproved.testnet", 0, START);
    fails(|| {
        c.request_advance(id.clone(), hash.clone(), U128(0))
            .detach();
    });
    call("exporter.testnet", 1, START);
    c.set_approver(Some(account("approver.testnet")));
    call("approver.testnet", 0, START);
    c.request_advance(id.clone(), hash, U128(7 * UNIT)).detach();
    assert_eq!(c.invoice(&id).advance.unwrap().amount.0, 7 * UNIT);
    callback(false, START);
    c.on_advance_sent(id.clone());
    let mut b = c.buyer(&account("buyer.testnet"));
    b.open_principal = U128(5 * UNIT);
    c.buyers.insert(&account("buyer.testnet"), &b);
    assert_eq!(
        c.preview_advance(id.clone()).reason.as_deref(),
        Some("buyer exposure limit reached: $5.00 open of $10.00")
    );
    b.open_principal = U128(0);
    b.frozen = true;
    c.buyers.insert(&account("buyer.testnet"), &b);
    assert_eq!(
        c.preview_advance(id.clone()).reason.as_deref(),
        Some("buyer frozen after default")
    );
    b.frozen = false;
    c.buyers.insert(&account("buyer.testnet"), &b);
    c.config.max_single_advance_bps = 1000;
    assert_eq!(
        c.preview_advance(id.clone()).reason.as_deref(),
        Some("single advance cap")
    );
    call("exporter.testnet", 1, START);
    c.set_approver(None);
    assert!(c.get_approver(account("exporter.testnet")).is_none());
}

#[test]
fn deposits_allowlist_share_transfers_redemption_and_revert() {
    let mut c = fresh();
    assert_eq!(
        received(
            &mut c,
            "lp.testnet",
            20 * UNIT,
            json!({"action":"deposit"}),
            START
        ),
        20 * UNIT
    );
    seed_pool(&mut c);
    assert_eq!(c.ft_balance_of(account("lp.testnet")).0, 20 * UNIT);
    assert!(standard_event("nep141", "ft_mint"));
    assert_eq!(c.preview_deposit(U128(UNIT)).0, UNIT);
    assert_eq!(c.preview_redeem(U128(UNIT)).0, UNIT);
    call("lp.testnet", 1, START);
    c.redeem(U128(5 * UNIT)).detach();
    assert!(standard_event("nep141", "ft_burn"));
    assert_eq!(
        (c.pool.idle.0, c.shares.total_supply),
        (15 * UNIT, 15 * UNIT)
    );
    fails(|| {
        c.storage_unregister(Some(true));
    });
    callback(false, START);
    assert!(!c.on_redeem(account("lp.testnet"), U128(5 * UNIT), U128(5 * UNIT)));
    assert_eq!(
        (c.pool.idle.0, c.shares.total_supply),
        (20 * UNIT, 20 * UNIT)
    );
    call("lp.testnet", 1, START);
    c.redeem(U128(5 * UNIT)).detach();
    callback(true, START);
    assert!(c.on_redeem(account("lp.testnet"), U128(5 * UNIT), U128(5 * UNIT)));
    call(
        "receiver.testnet",
        NearToken::from_near(1).as_yoctonear(),
        START,
    );
    c.storage_deposit(None, None);
    call("lp.testnet", 1, START);
    c.ft_transfer(account("receiver.testnet"), U128(UNIT), None);
    assert_eq!(c.ft_balance_of(account("receiver.testnet")).0, UNIT);
}

#[test]
#[should_panic(expected = "liquidity in advances")]
fn redeem_above_idle() {
    let mut c = fresh();
    funded(&mut c);
    call("lp.testnet", 1, START);
    c.redeem(U128(20 * UNIT)).detach();
}

#[test]
fn payout_failure_claim_failure_and_retry() {
    let mut c = fresh();
    callback(false, START);
    assert!(!c.on_payout(account("exporter.testnet"), U128(UNIT)));
    assert_eq!(c.get_claimable(account("exporter.testnet")).0, UNIT);
    call("exporter.testnet", 1, START);
    c.claim();
    assert_eq!(c.get_claimable(account("exporter.testnet")).0, 0);
    callback(false, START);
    c.on_payout(account("exporter.testnet"), U128(UNIT));
    assert_eq!(c.get_claimable(account("exporter.testnet")).0, UNIT);
    call("exporter.testnet", 1, START);
    c.claim();
    callback(true, START);
    c.on_payout(account("exporter.testnet"), U128(UNIT));
    assert_eq!(c.get_claimable(account("exporter.testnet")).0, 0);
}

#[test]
fn acceptance_permissions_hash_and_live_metadata() {
    let mut c = fresh();
    let i = create(&mut c, 10 * UNIT, 60);
    verify(&mut c, &i.id, "pass");
    call("exporter.testnet", 1, START);
    fails(|| c.accept_invoice(i.id.clone(), i.terms_hash.clone()));
    call("buyer.testnet", 1, START);
    fails(|| c.accept_invoice(i.id.clone(), "wrong".into()));
    c.accept_invoice(i.id.clone(), i.terms_hash);
    let t = c.nft_token(i.id.clone()).unwrap();
    assert_eq!(
        t.metadata.unwrap().title.unwrap(),
        "Tradewind invoice TW-0035"
    );
    assert_eq!(c.invoices_by_exporter(account("exporter.testnet")).len(), 1);
    assert_eq!(c.invoices_by_buyer(account("buyer.testnet")).len(), 1);
    assert_eq!(c.list_invoices(None, None).len(), 1);
    assert!(c.list_invoices(Some(U64(u64::MAX)), None).is_empty());
    call("anyone.testnet", 0, START + 3 * c.config.day_ns());
    assert_eq!(c.now_contract_day(i.id).unwrap().0, 3);
    assert!(c.now_contract_day("unknown".into()).is_none());
}

#[test]
fn create_and_verification_validation() {
    let mut c = fresh();
    fails(|| {
        create(&mut c, 50 * UNIT + 1, 60);
    });
    fails(|| {
        create(&mut c, 0, 60);
    });
    fails(|| {
        create(&mut c, UNIT, 0);
    });
    call(
        "buyer.testnet",
        NearToken::from_near(1).as_yoctonear(),
        START,
    );
    fails(|| {
        c.create_invoice(
            account("buyer.testnet"),
            "sample".into(),
            "1".into(),
            U128(UNIT),
            60,
            "ab".repeat(32),
            None,
        );
    });
    call(
        "exporter.testnet",
        NearToken::from_near(1).as_yoctonear(),
        START,
    );
    fails(|| {
        c.create_invoice(
            account("buyer.testnet"),
            "sample".into(),
            "1".into(),
            U128(UNIT),
            60,
            "AB".repeat(32),
            None,
        );
    });
    fails(|| {
        c.create_invoice(
            account("buyer.testnet"),
            "sample".into(),
            "1".repeat(65),
            U128(UNIT),
            60,
            "ab".repeat(32),
            None,
        );
    });
    fails(|| {
        c.create_invoice(
            account("buyer.testnet"),
            "sample".into(),
            "1".into(),
            U128(UNIT),
            60,
            "ab".repeat(32),
            Some("wrong".into()),
        );
    });
    let i = create(&mut c, UNIT, 60);
    let expected = c.compute_terms_hash(
        i.exporter,
        i.buyer,
        i.invoice_number,
        i.face,
        i.tenor_days,
        i.doc_hash,
    );
    assert_eq!(i.terms_hash, expected);
    call("exporter.testnet", 0, START);
    fails(|| c.record_verification(i.id.clone(), verification("pass")));
    call("attester.testnet", 0, START);
    let mut v = verification("pass");
    v.signature = "a".repeat(201);
    fails(|| c.record_verification(i.id.clone(), v));
    c.record_verification(i.id.clone(), verification("fail"));
    assert_eq!(c.invoice(&i.id).status, InvoiceStatus::Rejected);
    call("buyer.testnet", 1, START);
    fails(|| c.accept_invoice(i.id.clone(), expected));
}

#[test]
#[should_panic(expected = "insufficient storage deposit")]
fn creation_requires_storage_and_nft_reserve() {
    let mut c = fresh();
    call("exporter.testnet", 0, START);
    c.create_invoice(
        account("buyer.testnet"),
        "sample".into(),
        "1".into(),
        U128(UNIT),
        60,
        "ab".repeat(32),
        None,
    );
}

#[test]
#[should_panic(expected = "only USDC accepted")]
fn non_usdc_rejected() {
    let mut c = fresh();
    call("other-token.testnet", 0, START);
    let _ = c.ft_on_transfer(
        account("lp.testnet"),
        U128(UNIT),
        json!({"action":"repay"}).to_string(),
    );
}

#[test]
#[should_panic(expected = "Transfers disabled in MVP")]
fn nft_transfer_disabled() {
    let mut c = fresh();
    let id = accepted(&mut c);
    call("exporter.testnet", 1, START);
    c.nft_transfer(account("other.testnet"), id, None, None);
}

#[test]
fn owner_permissions_roles_and_resolution() {
    let mut c = fresh();
    call("other.testnet", 1, START);
    fails(|| c.pause());
    fails(|| c.set_owner(account("other.testnet")));
    call("owner.testnet", 0, START);
    fails(|| c.pause());
    call("owner.testnet", 1, START);
    c.set_roles(
        account("attester.testnet"),
        account("keeper.testnet"),
        Some(account("relayer.testnet")),
        account("treasury.testnet"),
    );
    assert_eq!(c.get_roles().relayer, Some(account("relayer.testnet")));
    let id = accepted(&mut c);
    repay(&mut c, "unknown", UNIT, START);
    call("owner.testnet", 1, START);
    fails(|| c.attribute_unattributed(U64(0), "unknown".into()));
    assert!(!c.unattributed.get(0).unwrap().resolved);
    c.attribute_unattributed(U64(0), id.clone());
    assert!(c.unattributed.get(0).unwrap().resolved);
    assert_eq!(c.invoice(&id).paid.to_exporter.0, UNIT);
    fails(|| c.refund_unattributed(U64(0), account("refund.testnet")));
    repay(&mut c, "unknown", UNIT, START);
    call("owner.testnet", 1, START);
    c.refund_unattributed(U64(1), account("refund.testnet"));
    assert!(c.unattributed.get(1).unwrap().resolved);
    event("admin_action");
    let mut b = c.buyer(&account("buyer.testnet"));
    b.frozen = true;
    c.buyers.insert(&account("buyer.testnet"), &b);
    c.unfreeze_buyer(account("buyer.testnet"));
    assert!(!c.buyer(&account("buyer.testnet")).frozen);
    c.set_owner(account("next-owner.testnet"));
    assert_eq!(c.get_roles().owner, account("next-owner.testnet"));
}

#[test]
fn pause_matrix_and_keeper_actions() {
    let mut c = fresh();
    let id = funded(&mut c);
    let accepted_id = accepted(&mut c);
    let other = create(&mut c, UNIT, 60);
    verify(&mut c, &other.id, "pass");
    call("owner.testnet", 1, START);
    c.pause();
    fails(|| {
        create(&mut c, UNIT, 60);
    });
    call("buyer.testnet", 1, START);
    fails(|| c.accept_invoice(other.id.clone(), other.terms_hash));
    assert_eq!(
        c.preview_advance(accepted_id.clone()).reason.as_deref(),
        Some("contract paused")
    );
    fails(|| request(&mut c, &accepted_id));
    assert_eq!(
        received(
            &mut c,
            "lp.testnet",
            UNIT,
            json!({"action":"deposit"}),
            START
        ),
        UNIT
    );
    call("lp.testnet", 1, START);
    c.redeem(U128(UNIT)).detach();
    callback(true, START);
    c.on_redeem(account("lp.testnet"), U128(UNIT), U128(UNIT));
    let due = c.invoice(&id).due_at.unwrap().0;
    call("anyone.testnet", 0, due + 1);
    c.mark_overdue(id.clone());
    let time = due + 31 * c.config.day_ns();
    call("anyone.testnet", 0, time);
    c.mark_default(id.clone());
    repay(&mut c, &id, 10 * UNIT, time);
    assert_eq!(c.invoice(&id).status, InvoiceStatus::Repaid);
    call("owner.testnet", 1, time);
    c.unpause();
    assert!(!c.config.paused);
}

#[test]
fn first_unit_then_large_deposit_is_fair() {
    let mut c = fresh();
    call("owner.testnet", 1, START);
    c.lp_allow(account("lp.testnet"), true);
    assert_eq!(
        received(&mut c, "lp.testnet", 1, json!({"action":"deposit"}), START),
        0
    );
    assert_eq!(
        received(
            &mut c,
            "lp.testnet",
            20 * UNIT,
            json!({"action":"deposit"}),
            START
        ),
        0
    );
    assert_eq!(
        (c.pool.idle.0, c.shares.total_supply),
        (20 * UNIT + 1, 20 * UNIT + 1)
    );
    // An unknown delivery is held as a liability, never counted as pool assets.
    received(
        &mut c,
        "donor.testnet",
        100 * UNIT,
        json!({"action":"donate"}),
        START,
    );
    assert_eq!(c.preview_deposit(U128(20 * UNIT)).0, 20 * UNIT);
    assert_eq!(c.get_pool().share_price_e6.0, UNIT);
}

#[test]
fn config_validation_and_sequence_are_not_reset() {
    let mut c = fresh();
    assert_eq!(c.get_config().usdc, account("usdc.testnet"));
    let first = create(&mut c, UNIT, 30);
    call("owner.testnet", 1, START);
    let mut config = c.get_config();
    config.invoice_counter_start = 1;
    c.set_config(config.clone());
    assert_eq!(create(&mut c, UNIT, 30).id, "TW-0036");
    assert_eq!(first.id, "TW-0035");
    call("owner.testnet", 1, START);
    config.seconds_per_day = 0;
    fails(|| c.set_config(config.clone()));
    config = c.get_config();
    config.max_rate_bps = 10_001;
    fails(|| c.set_config(config.clone()));
    config = c.get_config();
    config.usdc = account("other-token.testnet");
    fails(|| c.set_config(config));
}

#[test]
fn exact_time_boundaries_and_default_without_advance() {
    let mut c = fresh();
    let id = accepted(&mut c);
    let due = c.invoice(&id).due_at.unwrap().0;
    call("anyone.testnet", 0, due);
    fails(|| c.mark_overdue(id.clone()));
    assert_eq!(
        c.preview_advance(id.clone()).reason.as_deref(),
        Some("invoice due")
    );
    let deadline = due + u64::from(c.config.default_after_days) * c.config.day_ns();
    call("anyone.testnet", 0, deadline);
    fails(|| c.mark_default(id.clone()));
    call("anyone.testnet", 0, deadline + 1);
    c.mark_default(id.clone());
    assert_eq!(
        (c.pool.written_off.0, c.pool.outstanding_principal.0),
        (0, 0)
    );
    assert!(c.buyer(&account("buyer.testnet")).frozen);
    fails(|| c.mark_default(id.clone()));
    repay(&mut c, &id, 10 * UNIT, deadline + 2);
    let i = c.invoice(&id);
    assert_eq!((i.paid.to_exporter.0, i.paid.to_protocol.0), (10 * UNIT, 0));
    assert_eq!(c.buyer(&account("buyer.testnet")).recovered, 1);
}

#[test]
fn message_truncation_and_payment_ref_bounds() {
    let mut c = fresh();
    let id = accepted(&mut c);
    received(
        &mut c,
        "settlement.testnet",
        UNIT,
        json!({"action":"repay","invoice_id":id,"payment_ref":"é".repeat(200)}),
        START,
    );
    assert_eq!(c.invoice(&id).payments[0].payment_ref.chars().count(), 128);
    call("usdc.testnet", 0, START);
    let _ = c.ft_on_transfer(account("settlement.testnet"), U128(UNIT), "é".repeat(300));
    assert_eq!(c.unattributed.get(0).unwrap().msg.chars().count(), 256);
}

#[test]
fn all_owner_methods_reject_non_owner() {
    let mut c = fresh();
    let config = c.get_config();
    call("other.testnet", 1, START);
    fails(|| c.set_config(config));
    fails(|| {
        c.set_roles(
            account("other.testnet"),
            account("other.testnet"),
            None,
            account("other.testnet"),
        )
    });
    fails(|| c.lp_allow(account("other.testnet"), true));
    fails(|| c.pause());
    fails(|| c.unpause());
    fails(|| c.unfreeze_buyer(account("other.testnet")));
    fails(|| c.attribute_unattributed(U64(0), "unknown".into()));
    fails(|| c.refund_unattributed(U64(0), account("other.testnet")));
    fails(|| c.refund_overpaid("unknown".into(), account("other.testnet"), U128(1)));
    fails(|| c.set_owner(account("other.testnet")));
    fails(|| c.add_tee_signer(TEST_SIGNER.into()));
    fails(|| c.remove_tee_signer(TEST_SIGNER.into()));
    fails(|| c.set_buyer_limit_override(account("buyer.testnet"), Some(U128(UNIT))));
}

#[test]
fn live_svg_media_and_shared_mark() {
    use near_contract_standards::fungible_token::metadata::FungibleTokenMetadataProvider;
    use near_sdk::base64::{engine::general_purpose::STANDARD, Engine};
    let mut c = fresh();
    let id = accepted(&mut c);
    let mut i = c.invoice(&id);
    i.buyer_label = "<script>&\"' long label that must be truncated here".into();
    c.invoices.insert(&id, &i);
    for (status, text) in [
        (InvoiceStatus::Accepted, "Awaiting payment"),
        (InvoiceStatus::Funded, "Funded"),
        (InvoiceStatus::Repaid, "Paid"),
        (InvoiceStatus::Defaulted, "Defaulted"),
    ] {
        i.status = status;
        c.invoices.insert(&id, &i);
        let media = c
            .nft_token(id.clone())
            .unwrap()
            .metadata
            .unwrap()
            .media
            .unwrap();
        assert!(media.len() < 3072);
        let svg = String::from_utf8(
            STANDARD
                .decode(media.strip_prefix("data:image/svg+xml;base64,").unwrap())
                .unwrap(),
        )
        .unwrap();
        for expected in [
            &id[..],
            "$10.00",
            "Net 60",
            text,
            "&lt;script&gt;&amp;&quot;&apos;",
        ] {
            assert!(svg.contains(expected), "missing {expected}");
        }
        assert!(!svg.contains("<script>"));
        assert!(!svg.contains("truncated here"));
        assert_eq!(
            c.nft_tokens(None, None)[0]
                .metadata
                .as_ref()
                .unwrap()
                .media
                .as_ref(),
            Some(&media)
        );
        assert_eq!(
            c.nft_tokens_for_owner(account("exporter.testnet"), None, None)[0]
                .metadata
                .as_ref()
                .unwrap()
                .media
                .as_ref(),
            Some(&media)
        );
    }
    let icon = c.ft_metadata().icon.unwrap();
    assert!(icon.starts_with("data:image/svg+xml;base64,"));
    assert!(icon.len() < 2048);
    assert_eq!(c.nft_metadata().icon, Some(icon));
    i.buyer_label = "&".repeat(80);
    assert!(crate::visual::invoice_media(&i).len() < 3072);
    i.buyer_label = "🟢".repeat(80);
    assert!(crate::visual::invoice_media(&i).len() < 3072);
}

#[test]
fn preview_reasons_cover_every_branch_and_override() {
    let mut c = fresh();
    assert_eq!(
        c.preview_advance("missing".into()).reason.as_deref(),
        Some("invoice not found")
    );
    let created = create(&mut c, UNIT, 60);
    assert_eq!(
        c.preview_advance(created.id).reason.as_deref(),
        Some("invoice must be Accepted")
    );
    let id = accepted(&mut c);
    let mut i = c.invoice(&id);
    i.verification = None;
    c.invoices.insert(&id, &i);
    assert_eq!(
        c.preview_advance(id.clone()).reason.as_deref(),
        Some("verification not passed")
    );
    i.verification = Some(verification("pass"));
    c.invoices.insert(&id, &i);
    assert_eq!(
        c.preview_advance(id.clone()).reason.as_deref(),
        Some("pool idle liquidity too low")
    );
    seed_pool(&mut c);
    let mut b = c.buyer(&i.buyer);
    b.score = -1;
    c.buyers.insert(&i.buyer, &b);
    assert_eq!(
        c.preview_advance(id.clone()).reason.as_deref(),
        Some("buyer not eligible: negative score or zero advance rate")
    );
    b.score = 0;
    b.open_principal = U128(5 * UNIT);
    c.buyers.insert(&i.buyer, &b);
    assert_eq!(
        c.preview_advance(id.clone()).reason.as_deref(),
        Some("buyer exposure limit reached: $5.00 open of $10.00")
    );
    call("owner.testnet", 1, START);
    c.set_buyer_limit_override(i.buyer.clone(), Some(U128(15 * UNIT)));
    assert_eq!(
        c.get_buyer_record(i.buyer.clone()).buyer_limit,
        U128(15 * UNIT)
    );
    assert!(c.preview_advance(id.clone()).eligible);
    event("admin_action");
    c.set_buyer_limit_override(i.buyer.clone(), None);
    assert!(!c.preview_advance(id.clone()).eligible);
    b.open_principal = U128(0);
    c.buyers.insert(&i.buyer, &b);
    c.config.max_single_advance_bps = 1;
    assert_eq!(
        c.preview_advance(id.clone()).reason.as_deref(),
        Some("single advance cap")
    );
    c.config.max_single_advance_bps = 5000;
    i.face = U128(1);
    c.config.pool_fee_bps_per_30d = 0;
    c.config.protocol_fee_bps = 0;
    c.invoices.insert(&id, &i);
    assert_eq!(
        c.preview_advance(id.clone()).reason.as_deref(),
        Some("zero advance")
    );
    c.config.pool_fee_bps_per_30d = 75;
    c.config.protocol_fee_bps = 50;
    c.invoices.insert(&id, &i);
    assert_eq!(
        c.preview_advance(id).reason.as_deref(),
        Some("fees exceed face")
    );
}

#[test]
fn frozen_reason_identifies_default_even_after_recovery() {
    let mut c = fresh();
    let id = accepted(&mut c);
    let time = c.invoice(&id).due_at.unwrap().0 + 31 * c.config.day_ns();
    call("keeper.testnet", 0, time);
    c.mark_default(id.clone());
    repay(&mut c, &id, 10 * UNIT, time + 1);
    let next = accepted(&mut c);
    assert_eq!(
        c.preview_advance(next).reason,
        Some(format!("buyer frozen after default on {id}"))
    );
}

#[test]
fn cancellation_permissions_burn_enumeration_and_record_untouched() {
    let mut c = fresh();
    let first = create(&mut c, UNIT, 60);
    call("other.testnet", 0, START);
    fails(|| c.cancel_invoice(first.id.clone()));
    call("exporter.testnet", 0, START);
    c.cancel_invoice(first.id.clone());
    assert!(c.nft_token(first.id.clone()).is_none());
    let verified = create(&mut c, UNIT, 60);
    verify(&mut c, &verified.id, "pass");
    call("owner.testnet", 1, START);
    c.cancel_invoice(verified.id.clone());
    let id = accepted(&mut c);
    let retained = accepted(&mut c);
    let before =
        near_sdk::serde_json::to_value(c.get_buyer_record(account("buyer.testnet"))).unwrap();
    call("exporter.testnet", 0, START);
    fails(|| c.cancel_invoice(id.clone()));
    call("owner.testnet", 0, START);
    fails(|| c.cancel_invoice(id.clone()));
    call("owner.testnet", 1, START);
    c.cancel_invoice(id.clone());
    assert!(standard_event("nep171", "nft_burn"));
    event("invoice_cancelled");
    event("admin_action");
    assert_eq!(c.invoice(&id).status, InvoiceStatus::Cancelled);
    assert!(c.nft_token(id.clone()).is_none());
    assert_eq!(c.nft_total_supply(), U128(1));
    assert_eq!(c.nft_supply_for_owner(account("exporter.testnet")), U128(1));
    assert_eq!(c.nft_tokens(None, None)[0].token_id, retained);
    assert_eq!(
        near_sdk::serde_json::to_value(c.get_buyer_record(account("buyer.testnet"))).unwrap(),
        before
    );
    call("keeper.testnet", 0, START + 1000 * c.config.day_ns());
    fails(|| c.mark_default(id.clone()));
    fails(|| c.mark_overdue(id.clone()));
    let pending = funded(&mut c);
    call("owner.testnet", 1, START);
    fails(|| c.cancel_invoice(pending));
}

#[test]
fn cancellation_blocks_pending_and_clears_last_owner_enumeration() {
    let mut c = fresh();
    seed_pool(&mut c);
    let id = accepted(&mut c);
    request(&mut c, &id);
    call("owner.testnet", 1, START);
    fails(|| c.cancel_invoice(id.clone()));
    callback(false, START);
    c.on_advance_sent(id.clone());
    call("owner.testnet", 1, START);
    c.cancel_invoice(id.clone());
    assert_eq!(c.nft_total_supply(), U128(0));
    assert_eq!(c.nft_supply_for_owner(account("exporter.testnet")), U128(0));
    assert!(c.nft_tokens(None, None).is_empty());
    assert!(c
        .nft_tokens_for_owner(account("exporter.testnet"), None, None)
        .is_empty());
    // Terminal cancellation cannot be accepted or verified again.
    call("buyer.testnet", 1, START);
    fails(|| c.accept_invoice(id.clone(), c.invoice(&id).terms_hash));
    call("attester.testnet", 0, START);
    fails(|| c.record_verification(id.clone(), verification("pass")));
}

// Well-known public Ethereum test key (never use for funds):
// 0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318
const TEST_SIGNER: &str = "0x2c7536e3605d9c16a7a3d7b1898e529396a65c23";
const MESSAGE: &str = "verifiable-model:abababababababababababababababababababababababababababababababab:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";
// Signature produced by scripts/sign-test-vector.mjs (viem, EIP-191 personal_sign).
const SIG_HEX: &str = "0x9084f7ca99e0485f6020ea8a683be4d47165bbfd0476c62b2919fe2f60f50c4d678f366a104fa15a8792c855562f7ef236cf73bc5ea994e9a0787bcfd8ee06c01c";

fn signed_verification() -> Verification {
    let mut v = verification("pass");
    assert_eq!(
        format!("{}:{}:{}", v.model_id, v.request_hash, v.response_hash),
        MESSAGE
    );
    assert!(SIG_HEX.starts_with("0x"), "reviewer must fill SIG_HEX");
    v.signature = SIG_HEX.into();
    v.signing_address = TEST_SIGNER.into();
    v
}

#[test]
fn tee_valid_vector_sets_checked_flag() {
    let mut c = fresh();
    c.config.require_tee_signature = true;
    call("owner.testnet", 1, START);
    c.add_tee_signer(TEST_SIGNER.to_ascii_uppercase());
    // Both Ethereum v conventions, prefixed/unprefixed signature, and mixed-case address.
    for ethereum_v in [false, true] {
        let i = create(&mut c, UNIT, 60);
        let mut v = signed_verification();
        let hex = v.signature.trim_start_matches("0x");
        let recovery = u8::from_str_radix(&hex[128..], 16).unwrap();
        let recovery = if recovery >= 27 {
            recovery - 27
        } else {
            recovery
        };
        let recovery = if ethereum_v { recovery + 27 } else { recovery };
        v.signature = format!(
            "{}{}{recovery:02x}",
            if ethereum_v { "0x" } else { "" },
            &hex[..128]
        );
        v.signing_address = TEST_SIGNER.to_ascii_uppercase();
        call("attester.testnet", 0, START);
        c.record_verification(i.id.clone(), v);
        assert!(
            c.invoice(&i.id)
                .verification
                .unwrap()
                .signature_checked_on_chain
        );
    }
}

#[test]
#[should_panic(expected = "tee signature invalid")]
fn tee_wrong_claimed_address() {
    let mut c = fresh();
    c.config.require_tee_signature = true;
    let i = create(&mut c, UNIT, 60);
    let mut v = signed_verification();
    v.signing_address = format!("0x{}", "00".repeat(20));
    call("attester.testnet", 0, START);
    c.record_verification(i.id, v);
}

#[test]
#[should_panic(expected = "tee signer not allowlisted")]
fn tee_valid_but_not_allowlisted() {
    let mut c = fresh();
    c.config.require_tee_signature = true;
    let i = create(&mut c, UNIT, 60);
    call("attester.testnet", 0, START);
    c.record_verification(i.id, signed_verification());
}

#[test]
fn tee_allowlist_validation_and_flag_off_is_attester_compatible() {
    let mut c = fresh();
    assert!(!c.config.require_tee_signature);
    call("owner.testnet", 1, START);
    c.add_tee_signer(TEST_SIGNER.to_ascii_uppercase());
    assert_eq!(c.get_tee_signers(), vec![TEST_SIGNER.to_string()]);
    c.remove_tee_signer(TEST_SIGNER.into());
    assert!(c.get_tee_signers().is_empty());
    fails(|| c.add_tee_signer("0x1234".into()));
    fails(|| c.add_tee_signer(format!("0x{}", "zz".repeat(20))));
    call("owner.testnet", 0, START);
    fails(|| c.add_tee_signer(TEST_SIGNER.into()));
    let i = create(&mut c, UNIT, 60);
    let mut v = verification("pass");
    v.signature_checked_on_chain = true; // Never trust a caller-supplied flag.
    call("attester.testnet", 0, START);
    c.record_verification(i.id.clone(), v);
    assert!(
        !c.invoice(&i.id)
            .verification
            .unwrap()
            .signature_checked_on_chain
    );
}

#[test]
fn tee_malformed_signatures_rejected_before_any_write() {
    let mut c = fresh();
    c.config.require_tee_signature = true;
    let i = create(&mut c, UNIT, 60);
    for signature in [
        "not-hex".to_string(),
        "00".repeat(64),
        format!("{}02", "00".repeat(64)),
    ] {
        let mut v = verification("pass");
        v.signature = signature;
        call("attester.testnet", 0, START);
        let panic =
            catch_unwind(AssertUnwindSafe(|| c.record_verification(i.id.clone(), v))).unwrap_err();
        let message = panic
            .downcast_ref::<String>()
            .map(String::as_str)
            .or_else(|| panic.downcast_ref::<&str>().copied())
            .unwrap_or("");
        assert!(message.contains("tee signature invalid"));
        assert!(c.invoice(&i.id).verification.is_none());
    }
}

#[test]
#[should_panic(expected = "tee signature invalid")]
fn tee_requires_ecdsa() {
    let mut c = fresh();
    c.config.require_tee_signature = true;
    let i = create(&mut c, UNIT, 60);
    let mut v = verification("pass");
    v.signing_algo = "mock".into();
    call("attester.testnet", 0, START);
    c.record_verification(i.id, v);
}

#[test]
fn verification_json_defaults_checked_flag() {
    let mut value = near_sdk::serde_json::to_value(verification("pass")).unwrap();
    value
        .as_object_mut()
        .unwrap()
        .remove("signature_checked_on_chain");
    let v: Verification = near_sdk::serde_json::from_value(value).unwrap();
    assert!(!v.signature_checked_on_chain);
}
