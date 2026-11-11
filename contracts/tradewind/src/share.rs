use crate::*;
use near_contract_standards::{
    fungible_token::{
        core::FungibleTokenCore,
        events::{FtBurn, FtMint},
        metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC},
        resolver::FungibleTokenResolver,
    },
    storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement},
};

impl Contract {
    pub(crate) fn mint_shares(&mut self, account: &AccountId, amount: u128, memo: &str) {
        if !self.shares.accounts.contains_key(account) {
            self.shares.internal_register_account(account);
        }
        self.shares.internal_deposit(account, amount);
        FtMint {
            owner_id: account,
            amount: U128(amount),
            memo: Some(memo),
        }
        .emit();
    }
    pub(crate) fn burn_shares(&mut self, account: &AccountId, amount: u128, memo: &str) {
        self.shares.internal_withdraw(account, amount);
        FtBurn {
            owner_id: account,
            amount: U128(amount),
            memo: Some(memo),
        }
        .emit();
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.shares.ft_transfer(receiver_id, amount, memo);
    }
    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.shares.ft_transfer_call(receiver_id, amount, memo, msg)
    }
    fn ft_total_supply(&self) -> U128 {
        self.shares.ft_total_supply()
    }
    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.shares.ft_balance_of(account_id)
    }
}
#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        self.shares
            .ft_resolve_transfer(sender_id, receiver_id, amount)
    }
}
#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.shares.storage_deposit(account_id, registration_only)
    }
    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.shares.storage_withdraw(amount)
    }
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        assert!(
            self.pending_redeems
                .get(&env::predecessor_account_id())
                .unwrap_or(0)
                == 0,
            "redemption pending"
        );
        let balance = self
            .shares
            .accounts
            .get(&env::predecessor_account_id())
            .unwrap_or(0);
        let unregistered = self.shares.storage_unregister(force);
        if unregistered && balance > 0 {
            FtBurn {
                owner_id: &env::predecessor_account_id(),
                amount: U128(balance),
                memo: Some("storage unregister"),
            }
            .emit();
        }
        unregistered
    }
    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.shares.storage_balance_bounds()
    }
    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.shares.storage_balance_of(account_id)
    }
}
#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata { spec:FT_METADATA_SPEC.into(),name:"Tradewind Pool Share".into(),symbol:"twPOOL".into(),
            icon:Some("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%2300c08b'/%3E%3C/svg%3E".into()),
            reference:None,reference_hash:None,decimals:6 }
    }
}
