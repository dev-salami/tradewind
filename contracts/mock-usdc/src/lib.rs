use near_contract_standards::{
    fungible_token::{
        core::FungibleTokenCore,
        events::{FtBurn, FtMint},
        metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC},
        resolver::FungibleTokenResolver,
        FungibleToken,
    },
    storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement},
};
use near_sdk::{json_types::U128, near, AccountId, NearToken, PanicOnDefault, PromiseOrValue};

const MINT_CAP: u128 = 1_000 * 1_000_000;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self {
            token: FungibleToken::new(b"t".to_vec()),
        }
    }

    /// Public sandbox/testnet faucet. Never deploy this contract to mainnet.
    #[payable]
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        assert!(amount.0 > 0 && amount.0 <= MINT_CAP, "mint cap: 1,000 tUSDC");
        // NEP-145 checks the minimum deposit for new accounts and refunds excess
        // (including all attached funds for an already registered receiver).
        self.token
            .storage_deposit(Some(account_id.clone()), Some(true));
        self.token.internal_deposit(&account_id, amount.0);
        FtMint {
            owner_id: &account_id,
            amount,
            memo: Some("testnet faucet"),
        }
        .emit();
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo);
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
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
        self.token.ft_resolve_transfer(sender_id, receiver_id, amount)
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
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        let account = near_sdk::env::predecessor_account_id();
        let balance = self.token.ft_balance_of(account.clone());
        let removed = self.token.storage_unregister(force);
        if removed && balance.0 > 0 {
            FtBurn {
                owner_id: &account,
                amount: balance,
                memo: Some("storage unregister"),
            }
            .emit();
        }
        removed
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.into(),
            name: "Tradewind Test USDC".into(),
            symbol: "tUSDC".into(),
            decimals: 6,
            icon: None,
            reference: None,
            reference_hash: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{
        test_utils::{get_logs, VMContextBuilder},
        testing_env,
    };

    fn context(deposit: NearToken) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id("usdc.test.near".parse().unwrap())
            .predecessor_account_id("caller.test.near".parse().unwrap())
            .attached_deposit(deposit);
        testing_env!(builder.build());
    }

    #[test]
    fn metadata() {
        context(NearToken::from_yoctonear(0));
        let metadata = Contract::new().ft_metadata();
        metadata.assert_valid();
        assert_eq!(metadata.name, "Tradewind Test USDC");
        assert_eq!(metadata.symbol, "tUSDC");
        assert_eq!(metadata.decimals, 6);
        assert_eq!(metadata.spec, FT_METADATA_SPEC);
    }

    #[test]
    fn mint_at_cap_registers_and_emits_standard_event() {
        context(NearToken::from_near(1));
        let mut contract = Contract::new();
        let receiver: AccountId = "receiver.test.near".parse().unwrap();
        contract.mint(receiver.clone(), U128(MINT_CAP));
        assert_eq!(contract.ft_balance_of(receiver.clone()).0, MINT_CAP);
        assert!(contract.storage_balance_of(receiver.clone()).is_some());
        assert!(get_logs().iter().any(|log| {
            log.starts_with("EVENT_JSON:") && log.contains("\"event\":\"ft_mint\"")
        }));
        context(NearToken::from_yoctonear(0));
        contract.mint(receiver.clone(), U128(MINT_CAP));
        assert_eq!(contract.ft_balance_of(receiver).0, 2 * MINT_CAP);
        assert_eq!(contract.ft_total_supply().0, 2 * MINT_CAP);
    }

    #[test]
    #[should_panic(expected = "mint cap")]
    fn mint_above_cap_rejected() {
        context(NearToken::from_near(1));
        Contract::new().mint("receiver.test.near".parse().unwrap(), U128(MINT_CAP + 1));
    }

    #[test]
    #[should_panic(expected = "mint cap")]
    fn zero_mint_rejected() {
        context(NearToken::from_near(1));
        Contract::new().mint("receiver.test.near".parse().unwrap(), U128(0));
    }

    #[test]
    #[should_panic(expected = "attached deposit is less")]
    fn unregistered_receiver_needs_storage_deposit() {
        context(NearToken::from_yoctonear(0));
        Contract::new().mint("receiver.test.near".parse().unwrap(), U128(1));
    }
}
