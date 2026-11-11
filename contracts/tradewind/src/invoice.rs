use crate::*;
use crate::{config::NFT_MINT_RESERVE, events::emit, math};
use near_contract_standards::non_fungible_token::events::NftMint;
use near_sdk::serde_json::json;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InvoiceStatus {
    Created,
    Verified,
    Rejected,
    Accepted,
    AdvancePending,
    Funded,
    PartiallyPaid,
    Repaid,
    Defaulted,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Verification {
    pub verdict: String,
    pub model_id: String,
    pub request_hash: String,
    pub response_hash: String,
    pub signature: String,
    pub signing_address: String,
    pub signing_algo: String,
    pub chat_id: String,
    #[serde(default)]
    pub at: U64,
    #[serde(default)]
    pub signature_checked_on_chain: bool,
}
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct AdvanceTerms {
    pub rate_bps: u32,
    pub amount: U128,
    pub pool_fee: U128,
    pub protocol_fee: U128,
    pub at: U64,
}
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct PaidState {
    pub total: U128,
    pub to_pool_principal: U128,
    pub to_pool_fee: U128,
    pub to_protocol: U128,
    pub to_exporter: U128,
    pub overpaid: U128,
}
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Payment {
    pub amount: U128,
    pub at: U64,
    pub sender: AccountId,
    pub payment_ref: String,
}
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Invoice {
    pub id: String,
    pub exporter: AccountId,
    pub buyer: AccountId,
    pub buyer_label: String,
    pub invoice_number: String,
    pub face: U128,
    pub currency: String,
    pub tenor_days: u32,
    pub doc_hash: String,
    pub terms_hash: String,
    pub created_at: U64,
    pub accepted_at: Option<U64>,
    pub due_at: Option<U64>,
    pub verification: Option<Verification>,
    pub status: InvoiceStatus,
    pub overdue: bool,
    pub advance: Option<AdvanceTerms>,
    pub paid: PaidState,
    pub payments: Vec<Payment>,
    pub overpaid_refunded: U128,
    pub record_counted: bool,
    pub default_counted: bool,
    pub was_defaulted: bool,
}

pub(crate) fn valid_hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub(crate) fn terms_hash(
    exporter: &AccountId,
    buyer: &AccountId,
    invoice_number: &str,
    face: u128,
    tenor_days: u32,
    doc_hash: &str,
) -> String {
    let text =
        format!("tradewind:v1|{exporter}|{buyer}|{invoice_number}|{face}|{tenor_days}|{doc_hash}");
    env::sha256(text.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[near]
impl Contract {
    #[payable]
    pub fn create_invoice(
        &mut self,
        buyer: AccountId,
        buyer_label: String,
        invoice_number: String,
        face: U128,
        tenor_days: u32,
        doc_hash: String,
        terms_hash: Option<String>,
    ) -> Invoice {
        self.assert_active();
        let exporter = env::predecessor_account_id();
        assert!(
            face.0 > 0 && face.0 <= self.config.max_face.0,
            "invalid face"
        );
        assert!((1..=365).contains(&tenor_days), "invalid tenor");
        assert_ne!(buyer, exporter, "exporter must differ from buyer");
        assert!(valid_hash(&doc_hash), "invalid doc_hash");
        assert!(
            invoice_number.chars().count() <= 64 && buyer_label.chars().count() <= 80,
            "field too long"
        );
        let computed = crate::invoice::terms_hash(
            &exporter,
            &buyer,
            &invoice_number,
            face.0,
            tenor_days,
            &doc_hash,
        );
        if let Some(t) = terms_hash {
            assert_eq!(t, computed, "terms changed");
        }
        let before = env::storage_usage();
        let id = format!("TW-{:04}", self.next_invoice_seq);
        self.next_invoice_seq = self
            .next_invoice_seq
            .checked_add(1)
            .expect("invoice counter exhausted");
        let i = Invoice {
            id: id.clone(),
            exporter: exporter.clone(),
            buyer: buyer.clone(),
            buyer_label,
            invoice_number,
            face,
            currency: "USDC".into(),
            tenor_days,
            doc_hash,
            terms_hash: computed,
            created_at: U64(env::block_timestamp()),
            accepted_at: None,
            due_at: None,
            verification: None,
            status: InvoiceStatus::Created,
            overdue: false,
            advance: None,
            paid: PaidState::default(),
            payments: vec![],
            overpaid_refunded: U128(0),
            record_counted: false,
            default_counted: false,
            was_defaulted: false,
        };
        self.invoices.insert(&id, &i);
        self.invoice_ids.push(&id);
        let mut exports = self.invoices_by_exporter.get(&exporter).unwrap_or_else(|| {
            IterableSet::new(StorageKey::ExporterSet {
                hash: env::sha256(exporter.as_bytes()),
            })
        });
        exports.insert(id.clone());
        exports.flush();
        self.invoices_by_exporter.insert(&exporter, &exports);
        let mut buys = self.invoices_by_buyer.get(&buyer).unwrap_or_else(|| {
            IterableSet::new(StorageKey::BuyerSet {
                hash: env::sha256(buyer.as_bytes()),
            })
        });
        buys.insert(id.clone());
        buys.flush();
        self.invoices_by_buyer.insert(&buyer, &buys);
        let bytes = env::storage_usage().saturating_sub(before);
        let required = u128::from(bytes)
            .checked_mul(env::storage_byte_cost().as_yoctonear())
            .and_then(|n| n.checked_add(NFT_MINT_RESERVE))
            .expect("storage cost overflow");
        let attached = env::attached_deposit().as_yoctonear();
        assert!(attached >= required, "insufficient storage deposit");
        if attached > required {
            Promise::new(exporter)
                .transfer(NearToken::from_yoctonear(attached - required))
                .detach();
        }
        emit("invoice_created", json!({"invoice_id": id, "invoice": i}));
        i
    }

    pub fn record_verification(&mut self, id: String, v: Verification) {
        let mut v = v;
        assert_eq!(
            env::predecessor_account_id(),
            self.attester,
            "attester only"
        );
        let mut i = self.invoice(&id);
        assert_eq!(i.status, InvoiceStatus::Created, "invalid status");
        assert!(
            ["pass", "warn", "fail"].contains(&v.verdict.as_str()),
            "invalid verdict"
        );
        assert!(
            valid_hash(&v.request_hash) && valid_hash(&v.response_hash),
            "invalid verification hash"
        );
        assert!(
            v.signature.chars().count() <= 200
                && v.model_id.chars().count() <= 100
                && v.chat_id.chars().count() <= 100,
            "verification too long"
        );
        assert!(
            v.signing_address.chars().count() <= 200 && v.signing_algo.chars().count() <= 32,
            "verification too long"
        );
        v.signature_checked_on_chain = false;
        if self.config.require_tee_signature {
            self.check_tee_signature(&v);
            v.signature_checked_on_chain = true;
        }
        let passed = v.verdict == "pass";
        v.at = U64(env::block_timestamp());
        i.verification = Some(v);
        i.status = if passed {
            InvoiceStatus::Verified
        } else {
            InvoiceStatus::Rejected
        };
        self.invoices.insert(&id, &i);
        emit(
            if passed {
                "invoice_verified"
            } else {
                "invoice_rejected"
            },
            json!({"invoice_id":id,"verification":i.verification}),
        );
    }

    #[payable]
    pub fn cancel_invoice(&mut self, id: String) {
        let mut i = self.invoice(&id);
        let owner = env::predecessor_account_id() == self.owner;
        if owner {
            self.assert_owner();
        } else {
            assert_eq!(
                env::predecessor_account_id(), i.exporter,
                "exporter or owner only"
            );
            assert_ne!(i.status, InvoiceStatus::Accepted, "invoice already accepted");
            assert_eq!(
                env::attached_deposit().as_yoctonear(), 0,
                "no deposit required"
            );
        }
        assert!(
            matches!(
                i.status,
                InvoiceStatus::Created
                    | InvoiceStatus::Verified
                    | InvoiceStatus::Rejected
                    | InvoiceStatus::Accepted
            ),
            "invalid status"
        );
        assert!(i.advance.is_none(), "invoice has an advance");
        self.burn_invoice_nft(&id);
        i.status = InvoiceStatus::Cancelled;
        self.invoices.insert(&id, &i);
        if owner {
            emit("admin_action", json!({"action":"cancel_invoice","invoice_id":id}));
        }
        emit("invoice_cancelled", json!({"invoice_id":id}));
    }

    #[payable]
    pub fn accept_invoice(&mut self, id: String, terms_hash: String) {
        assert_one_yocto();
        self.assert_active();
        let mut i = self.invoice(&id);
        assert_eq!(env::predecessor_account_id(), i.buyer, "buyer only");
        assert_eq!(i.status, InvoiceStatus::Verified, "invalid status");
        assert_eq!(terms_hash, i.terms_hash, "terms changed");
        let now = env::block_timestamp();
        i.accepted_at = Some(U64(now));
        i.due_at = Some(U64(now
            .checked_add(
                u64::from(i.tenor_days)
                    .checked_mul(self.config.day_ns())
                    .expect("time overflow"),
            )
            .expect("time overflow")));
        i.status = InvoiceStatus::Accepted;
        self.nft
            .internal_mint_with_refund(id.clone(), i.exporter.clone(), None, None);
        NftMint {
            owner_id: &i.exporter,
            token_ids: &[&id],
            memo: None,
        }
        .emit();
        let mut b = self.buyer(&i.buyer);
        b.accepted = b.accepted.saturating_add(1);
        b.last_update = U64(now);
        self.buyers.insert(&i.buyer, &b);
        self.invoices.insert(&id, &i);
        emit(
            "invoice_accepted",
            json!({"invoice_id":id,"accepted_at":i.accepted_at,"due_at":i.due_at}),
        );
    }

    #[payable]
    pub fn set_approver(&mut self, approver: Option<AccountId>) {
        assert_one_yocto();
        let exporter = env::predecessor_account_id();
        if let Some(a) = &approver {
            self.approvers.insert(&exporter, a);
        } else {
            self.approvers.remove(&exporter);
        }
        emit(
            "approver_updated",
            json!({"exporter":exporter,"approver":approver}),
        );
    }

    pub fn request_advance(
        &mut self,
        id: String,
        expected_terms_hash: String,
        min_advance: U128,
    ) -> Promise {
        self.assert_active();
        let mut i = self.invoice(&id);
        let caller = env::predecessor_account_id();
        assert!(
            caller == i.exporter || self.approvers.get(&i.exporter).as_ref() == Some(&caller),
            "exporter or approver only"
        );
        assert_eq!(expected_terms_hash, i.terms_hash, "terms changed");
        let preview = self.preview_advance(id.clone());
        assert!(preview.eligible, "{}", preview.reason.unwrap_or_default());
        assert!(preview.advance.0 >= min_advance.0, "terms changed");
        let t = math::advance_terms(i.face.0, i.tenor_days, preview.rate_bps, &self.config)
            .expect("invalid advance terms");
        let mut b = self.buyer(&i.buyer);
        self.pool.idle.0 -= t.advance;
        self.pool.outstanding_principal.0 = self
            .pool
            .outstanding_principal
            .0
            .checked_add(t.advance)
            .expect("pool overflow");
        b.open_principal.0 = b
            .open_principal
            .0
            .checked_add(t.advance)
            .expect("exposure overflow");
        i.advance = Some(AdvanceTerms {
            rate_bps: preview.rate_bps,
            amount: U128(t.advance),
            pool_fee: U128(t.pool_fee),
            protocol_fee: U128(t.protocol_fee),
            at: U64(env::block_timestamp()),
        });
        i.status = InvoiceStatus::AdvancePending;
        self.move_nft(&id, &i.exporter, &env::current_account_id());
        self.buyers.insert(&i.buyer, &b);
        self.invoices.insert(&id, &i);
        self.send_usdc(i.exporter, t.advance).then(
            Self::ext(env::current_account_id())
                .with_static_gas(Self::callback_gas())
                .with_unused_gas_weight(0)
                .on_advance_sent(id),
        )
    }

    #[private]
    pub fn on_advance_sent(&mut self, id: String) -> bool {
        let mut i = self.invoice(&id);
        assert_eq!(
            i.status,
            InvoiceStatus::AdvancePending,
            "no pending advance"
        );
        let success = Self::promise_succeeded();
        let a = i.advance.clone().expect("missing advance");
        if success {
            i.status = InvoiceStatus::Funded;
        } else {
            i.status = InvoiceStatus::Accepted;
            i.advance = None;
            self.pool.idle.0 = self
                .pool
                .idle
                .0
                .checked_add(a.amount.0)
                .expect("pool overflow");
            self.pool.outstanding_principal.0 = self
                .pool
                .outstanding_principal
                .0
                .checked_sub(a.amount.0)
                .expect("principal invariant");
            let mut b = self.buyer(&i.buyer);
            b.open_principal.0 = b
                .open_principal
                .0
                .checked_sub(a.amount.0)
                .expect("exposure invariant");
            self.buyers.insert(&i.buyer, &b);
            self.move_nft(&id, &env::current_account_id(), &i.exporter);
        }
        self.invoices.insert(&id, &i);
        emit(
            if success {
                "advance_paid"
            } else {
                "advance_reverted"
            },
            json!({"invoice_id":id,"amount":a.amount,"rate_bps":a.rate_bps,"pool_fee":a.pool_fee,"protocol_fee":a.protocol_fee}),
        );
        success
    }

    pub fn mark_overdue(&mut self, id: String) {
        let mut i = self.invoice(&id);
        assert!(
            matches!(
                i.status,
                InvoiceStatus::Accepted | InvoiceStatus::Funded | InvoiceStatus::PartiallyPaid
            ),
            "invalid status"
        );
        assert!(
            env::block_timestamp() > i.due_at.expect("not accepted").0,
            "not overdue"
        );
        assert!(!i.overdue, "already overdue");
        i.overdue = true;
        self.invoices.insert(&id, &i);
        emit("invoice_overdue", json!({"invoice_id":id}));
    }

    pub fn mark_default(&mut self, id: String) {
        let mut i = self.invoice(&id);
        assert!(
            matches!(
                i.status,
                InvoiceStatus::Accepted | InvoiceStatus::Funded | InvoiceStatus::PartiallyPaid
            ),
            "invalid status"
        );
        let deadline = i.due_at.expect("not accepted").0.saturating_add(
            u64::from(self.config.default_after_days).saturating_mul(self.config.day_ns()),
        );
        assert!(env::block_timestamp() > deadline, "not defaultable");
        let unpaid = i
            .advance
            .as_ref()
            .map(|a| a.amount.0.saturating_sub(i.paid.to_pool_principal.0))
            .unwrap_or(0);
        self.pool.outstanding_principal.0 = self
            .pool
            .outstanding_principal
            .0
            .checked_sub(unpaid)
            .expect("principal invariant");
        self.pool.written_off.0 = self
            .pool
            .written_off
            .0
            .checked_add(unpaid)
            .expect("write-off overflow");
        let mut b = self.buyer(&i.buyer);
        b.open_principal.0 = b
            .open_principal
            .0
            .checked_sub(unpaid)
            .expect("exposure invariant");
        i.status = InvoiceStatus::Defaulted;
        i.was_defaulted = true;
        if self.counts(&i) && !i.default_counted {
            let delta = b.record_default(&self.config, env::block_timestamp());
            i.default_counted = true;
            self.emit_record(&i, &b, delta);
        }
        self.buyers.insert(&i.buyer, &b);
        self.invoices.insert(&id, &i);
        emit(
            "invoice_defaulted",
            json!({"invoice_id":id,"written_off":U128(unpaid)}),
        );
    }
}
