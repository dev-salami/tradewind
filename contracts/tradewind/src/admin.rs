use crate::events::emit;
use crate::*;
use near_sdk::serde_json::json;

#[near]
impl Contract {
    #[payable]
    pub fn add_tee_signer(&mut self, address: String) {
        self.assert_owner();
        let address = crate::tee::normalise_address(&address).expect("invalid tee address");
        self.tee_signers.insert(&address);
        emit(
            "admin_action",
            json!({"action":"add_tee_signer","address":address}),
        );
    }
    #[payable]
    pub fn remove_tee_signer(&mut self, address: String) {
        self.assert_owner();
        let address = crate::tee::normalise_address(&address).expect("invalid tee address");
        self.tee_signers.remove(&address);
        emit(
            "admin_action",
            json!({"action":"remove_tee_signer","address":address}),
        );
    }
    #[payable]
    pub fn set_buyer_limit_override(&mut self, account_id: AccountId, limit: Option<U128>) {
        self.assert_owner();
        if let Some(limit) = limit {
            self.buyer_limit_overrides.insert(&account_id, &limit.0);
        } else {
            self.buyer_limit_overrides.remove(&account_id);
        }
        emit(
            "admin_action",
            json!({"action":"set_buyer_limit_override","account_id":account_id,"limit":limit}),
        );
    }
    #[payable]
    pub fn set_config(&mut self, config: Config) {
        self.assert_owner();
        config.validate();
        // Changing the asset would strand obligations denominated in the original USDC.
        assert_eq!(config.usdc, self.config.usdc, "USDC cannot change");
        self.config = config;
        emit(
            "admin_action",
            json!({"action":"set_config","config":self.config}),
        );
    }
    #[payable]
    pub fn set_roles(
        &mut self,
        attester: AccountId,
        keeper: AccountId,
        relayer: Option<AccountId>,
        treasury: AccountId,
    ) {
        self.assert_owner();
        self.attester = attester;
        self.keeper = keeper;
        self.relayer = relayer;
        self.treasury = treasury;
        emit(
            "admin_action",
            json!({"action":"set_roles","roles":self.get_roles()}),
        );
    }
    #[payable]
    pub fn lp_allow(&mut self, account_id: AccountId, allowed: bool) {
        self.assert_owner();
        if allowed {
            self.lp_allowlist.insert(&account_id);
        } else {
            self.lp_allowlist.remove(&account_id);
        }
        emit(
            "admin_action",
            json!({"action":"lp_allow","account_id":account_id,"allowed":allowed}),
        );
    }
    #[payable]
    pub fn pause(&mut self) {
        self.assert_owner();
        self.config.paused = true;
        emit("admin_action", json!({"action":"pause"}));
    }
    #[payable]
    pub fn unpause(&mut self) {
        self.assert_owner();
        self.config.paused = false;
        emit("admin_action", json!({"action":"unpause"}));
    }
    #[payable]
    pub fn unfreeze_buyer(&mut self, account_id: AccountId) {
        self.assert_owner();
        let mut b = self.buyer(&account_id);
        b.frozen = false;
        b.last_update = U64(env::block_timestamp());
        self.buyers.insert(&account_id, &b);
        emit(
            "admin_action",
            json!({"action":"unfreeze_buyer","account_id":account_id}),
        );
    }
    #[payable]
    pub fn attribute_unattributed(&mut self, index: U64, invoice_id: String) {
        self.assert_owner();
        let mut p = self.unattributed.get(index.0).expect("payment not found");
        assert!(!p.resolved, "already resolved");
        self.apply_payment(
            &invoice_id,
            p.amount.0,
            p.sender.clone(),
            format!("attributed:{}", index.0),
        )
        .unwrap_or_else(|reason| env::panic_str(&reason));
        p.resolved = true;
        self.unattributed.replace(index.0, &p);
        emit(
            "admin_action",
            json!({"action":"attribute_unattributed","index":index,"invoice_id":invoice_id}),
        );
    }
    #[payable]
    pub fn refund_unattributed(&mut self, index: U64, to: AccountId) {
        self.assert_owner();
        let mut p = self.unattributed.get(index.0).expect("payment not found");
        assert!(!p.resolved, "already resolved");
        p.resolved = true;
        self.unattributed.replace(index.0, &p);
        self.push_payout(to.clone(), p.amount.0);
        emit(
            "admin_action",
            json!({"action":"refund_unattributed","index":index,"to":to,"amount":p.amount}),
        );
    }
    #[payable]
    pub fn refund_overpaid(&mut self, id: String, to: AccountId, amount: U128) {
        self.assert_owner();
        let mut i = self.invoice(&id);
        assert!(
            amount.0 <= i.paid.overpaid.0.saturating_sub(i.overpaid_refunded.0),
            "exceeds overpaid"
        );
        i.overpaid_refunded.0 = i
            .overpaid_refunded
            .0
            .checked_add(amount.0)
            .expect("refund overflow");
        self.invoices.insert(&id, &i);
        self.push_payout(to.clone(), amount.0);
        emit(
            "admin_action",
            json!({"action":"refund_overpaid","invoice_id":id,"to":to,"amount":amount}),
        );
    }
    #[payable]
    pub fn set_owner(&mut self, new_owner: AccountId) {
        self.assert_owner();
        self.owner = new_owner;
        emit(
            "admin_action",
            json!({"action":"set_owner","owner":self.owner}),
        );
    }
}
