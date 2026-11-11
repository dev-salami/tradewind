use crate::*;
use crate::{config::MAX_PAYMENTS, events::emit, invoice::Payment, math};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::serde_json::{json, Value};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct StrayPayment {
    pub sender: AccountId,
    pub amount: U128,
    pub msg: String,
    pub at: U64,
    pub resolved: bool,
}
fn truncated(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

#[near]
impl FungibleTokenReceiver for Contract {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        assert_eq!(
            env::predecessor_account_id(),
            self.config.usdc,
            "only USDC accepted"
        );
        let parsed = near_sdk::serde_json::from_str::<Value>(&msg).ok();
        let action = parsed
            .as_ref()
            .and_then(|v| v.get("action"))
            .and_then(Value::as_str);
        match action {
            Some("deposit") => {
                return PromiseOrValue::Value(U128(self.deposit(&sender_id, amount.0)))
            }
            Some("repay") => {
                let id = parsed
                    .as_ref()
                    .and_then(|v| v.get("invoice_id"))
                    .and_then(Value::as_str);
                let payment_ref = parsed
                    .as_ref()
                    .and_then(|v| v.get("payment_ref"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if let Some(id) = id {
                    if let Err(reason) = self.apply_payment(
                        id,
                        amount.0,
                        sender_id.clone(),
                        truncated(payment_ref, 128),
                    ) {
                        self.book_stray(sender_id, amount.0, &msg, &reason);
                    }
                } else {
                    self.book_stray(sender_id, amount.0, &msg, "missing invoice_id");
                }
            }
            _ => self.book_stray(sender_id, amount.0, &msg, "unknown or malformed message"),
        }
        PromiseOrValue::Value(U128(0))
    }
}

impl Contract {
    pub(crate) fn book_stray(&mut self, sender: AccountId, amount: u128, msg: &str, reason: &str) {
        let index = self.unattributed.len();
        self.unattributed.push(&StrayPayment {
            sender: sender.clone(),
            amount: U128(amount),
            msg: truncated(msg, 256),
            at: U64(env::block_timestamp()),
            resolved: false,
        });
        emit(
            "unattributed_payment",
            json!({"index":U64(index),"sender":sender,"amount":U128(amount),"reason":reason}),
        );
    }

    // All rejection checks precede writes and promises. The receiver books errors rather
    // than refunding an Intents sender; owner attribution surfaces the same error.
    pub(crate) fn apply_payment(
        &mut self,
        id: &str,
        amount: u128,
        sender: AccountId,
        payment_ref: String,
    ) -> Result<(), String> {
        let mut i = self
            .invoices
            .get(&id.to_string())
            .ok_or("invoice not found")?;
        if matches!(
            i.status,
            InvoiceStatus::Created
                | InvoiceStatus::Verified
                | InvoiceStatus::Rejected
                | InvoiceStatus::Cancelled
                | InvoiceStatus::AdvancePending
        ) {
            return Err("invoice cannot receive payments in this status".into());
        }
        if i.payments.len() >= MAX_PAYMENTS {
            return Err("payment limit reached".into());
        }
        let outstanding = i
            .face
            .0
            .saturating_sub(i.paid.total.0.saturating_sub(i.paid.overpaid.0));
        if amount < self.config.min_payment.0 && amount < outstanding {
            return Err("below min_payment".into());
        }
        let total = i
            .paid
            .total
            .0
            .checked_add(amount)
            .ok_or("payment total overflow")?;
        let split = math::apply_waterfall(i.face.0, i.advance.as_ref(), &i.paid, amount);
        let x = split.to_pool_principal.0;
        let y = split.to_pool_fee.0;
        let z = split.to_protocol.0;
        let w = split.to_exporter.0;
        let pool_in = x.checked_add(y).ok_or("pool overflow")?;
        let new_idle = self
            .pool
            .idle
            .0
            .checked_add(pool_in)
            .ok_or("pool overflow")?;
        let new_fees = self
            .pool
            .fees_earned
            .0
            .checked_add(y)
            .ok_or("fee overflow")?;
        let new_protocol = self
            .pool
            .protocol_fees_paid
            .0
            .checked_add(z)
            .ok_or("fee overflow")?;
        let mut b = self.buyer(&i.buyer);
        let defaulted = i.was_defaulted;
        let new_outstanding = if defaulted {
            self.pool.outstanding_principal.0
        } else {
            self.pool
                .outstanding_principal
                .0
                .checked_sub(x)
                .ok_or("principal invariant")?
        };
        let new_written_off = if defaulted {
            self.pool
                .written_off
                .0
                .checked_sub(x)
                .ok_or("write-off invariant")?
        } else {
            self.pool.written_off.0
        };
        new_idle
            .checked_add(new_outstanding)
            .ok_or("assets overflow")?;
        if !defaulted {
            b.open_principal.0 = b
                .open_principal
                .0
                .checked_sub(x)
                .ok_or("exposure invariant")?;
        }
        // Each tranche is bounded by face; excess plus total is checked above.
        i.paid.total = U128(total);
        i.paid.to_pool_principal.0 += x;
        i.paid.to_pool_fee.0 += y;
        i.paid.to_protocol.0 += z;
        i.paid.to_exporter.0 += w;
        i.paid.overpaid.0 = i
            .paid
            .overpaid
            .0
            .checked_add(split.overpaid.0)
            .ok_or("overpayment overflow")?;
        self.pool.idle = U128(new_idle);
        self.pool.outstanding_principal = U128(new_outstanding);
        self.pool.written_off = U128(new_written_off);
        self.pool.fees_earned = U128(new_fees);
        self.pool.protocol_fees_paid = U128(new_protocol);
        let now = env::block_timestamp();
        i.payments.push(Payment {
            amount: U128(amount),
            at: U64(now),
            sender: sender.clone(),
            payment_ref: truncated(&payment_ref, 128),
        });
        emit(
            "payment_received",
            json!({"invoice_id":id,"amount":U128(amount),"sender":sender,"payment_ref":truncated(&payment_ref,128)}),
        );
        emit(
            "waterfall_split",
            json!({"invoice_id":id,"to_pool_principal":split.to_pool_principal,"to_pool_fee":split.to_pool_fee,"to_protocol":split.to_protocol,"to_exporter":split.to_exporter,"overpaid":split.overpaid}),
        );
        let was_repaid = i.status == InvoiceStatus::Repaid;
        let full = i.paid.total.0.saturating_sub(i.paid.overpaid.0) >= i.face.0;
        if full {
            i.status = InvoiceStatus::Repaid;
            i.overdue = false;
            if !was_repaid {
                let due = i.due_at.map(|d| d.0).unwrap_or(0);
                let outcome = if defaulted {
                    "after_default"
                } else if now <= due {
                    "on_time"
                } else if now
                    <= due.saturating_add(
                        u64::from(self.config.grace_days).saturating_mul(self.config.day_ns()),
                    )
                {
                    "grace"
                } else {
                    "late"
                };
                if self.counts(&i) && !i.record_counted {
                    let delta = b.record_repayment(i.face.0, outcome, &self.config, now);
                    i.record_counted = true;
                    self.emit_record(&i, &b, delta);
                }
                if self.nft.owner_by_id.get(&i.id) == Some(env::current_account_id()) {
                    self.move_nft(&i.id, &env::current_account_id(), &i.exporter);
                }
                emit("invoice_repaid", json!({"invoice_id":id,"outcome":outcome}));
            }
        } else {
            i.status = if defaulted {
                InvoiceStatus::Defaulted
            } else {
                InvoiceStatus::PartiallyPaid
            };
        }
        self.buyers.insert(&i.buyer, &b);
        self.invoices.insert(&i.id, &i);
        self.push_payout(self.treasury.clone(), z);
        self.push_payout(i.exporter, w);
        Ok(())
    }

    pub(crate) fn push_payout(&self, to: AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        self.send_usdc(to.clone(), amount)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Self::callback_gas())
                    .with_unused_gas_weight(0)
                    .on_payout(to, U128(amount)),
            )
            .detach();
    }
}

#[near]
impl Contract {
    #[private]
    pub fn on_payout(&mut self, to: AccountId, amount: U128) -> bool {
        let success = Self::promise_succeeded();
        if !success {
            let balance = self
                .claimable
                .get(&to)
                .unwrap_or(0)
                .checked_add(amount.0)
                .expect("claimable overflow");
            self.claimable.insert(&to, &balance);
        }
        success
    }

    #[payable]
    pub fn claim(&mut self) {
        assert_one_yocto();
        let caller = env::predecessor_account_id();
        let amount = self.claimable.remove(&caller).unwrap_or(0);
        self.push_payout(caller, amount);
    }
}
