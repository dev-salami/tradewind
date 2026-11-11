// create_invoice mirrors the spec ABI (8 args); construct_uint! expands code clippy flags.
#![allow(clippy::too_many_arguments, clippy::manual_div_ceil)]
use near_contract_standards::{
    fungible_token::FungibleToken, non_fungible_token::NonFungibleToken,
};
use near_sdk::{
    assert_one_yocto,
    borsh::BorshSerialize,
    collections::{LookupMap, LookupSet, Vector},
    env, ext_contract,
    json_types::{U128, U64},
    near,
    store::IterableSet,
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};

mod admin;
pub mod config;
mod events;
pub mod invoice;
pub mod math;
mod nft;
pub mod payments;
pub mod pool;
pub mod record;
mod share;
pub mod views;

use config::Config;
use invoice::{Invoice, InvoiceStatus};
use payments::StrayPayment;
use pool::Pool;
use record::BuyerRecord;

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Invoices,
    InvoiceIds,
    Exporters,
    BuyersIndex,
    BuyerRecords,
    Approvers,
    Lp,
    Shares,
    Nft,
    NftEnumeration,
    Claimable,
    Unattributed,
    PendingRedeems,
    ExporterSet { hash: Vec<u8> },
    BuyerSet { hash: Vec<u8> },
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    treasury: AccountId,
    attester: AccountId,
    keeper: AccountId,
    relayer: Option<AccountId>,
    config: Config,
    invoices: LookupMap<String, Invoice>,
    invoice_ids: Vector<String>,
    invoices_by_exporter: LookupMap<AccountId, IterableSet<String>>,
    invoices_by_buyer: LookupMap<AccountId, IterableSet<String>>,
    buyers: LookupMap<AccountId, BuyerRecord>,
    approvers: LookupMap<AccountId, AccountId>,
    lp_allowlist: LookupSet<AccountId>,
    pool: Pool,
    shares: FungibleToken,
    nft: NonFungibleToken,
    claimable: LookupMap<AccountId, u128>,
    unattributed: Vector<StrayPayment>,
    next_invoice_seq: u64,
    // Prevent unregistering shares while a failed redemption may need to re-mint.
    pending_redeems: LookupMap<AccountId, u32>,
}

#[allow(dead_code)]
#[ext_contract(ext_usdc)]
trait Usdc {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        owner: AccountId,
        treasury: AccountId,
        usdc: AccountId,
        attester: AccountId,
        keeper: AccountId,
        config: Option<Config>,
    ) -> Self {
        let mut config = config.unwrap_or_else(Config::demo_default);
        config.usdc = usdc;
        config.validate();
        Self {
            owner,
            treasury,
            attester,
            keeper,
            relayer: None,
            next_invoice_seq: config.invoice_counter_start,
            config,
            invoices: LookupMap::new(StorageKey::Invoices),
            invoice_ids: Vector::new(StorageKey::InvoiceIds),
            invoices_by_exporter: LookupMap::new(StorageKey::Exporters),
            invoices_by_buyer: LookupMap::new(StorageKey::BuyersIndex),
            buyers: LookupMap::new(StorageKey::BuyerRecords),
            approvers: LookupMap::new(StorageKey::Approvers),
            lp_allowlist: LookupSet::new(StorageKey::Lp),
            pool: Pool::default(),
            shares: FungibleToken::new(StorageKey::Shares),
            nft: NonFungibleToken::new(
                StorageKey::Nft,
                env::current_account_id(),
                None::<StorageKey>,
                Some(StorageKey::NftEnumeration),
                None::<StorageKey>,
            ),
            claimable: LookupMap::new(StorageKey::Claimable),
            unattributed: Vector::new(StorageKey::Unattributed),
            pending_redeems: LookupMap::new(StorageKey::PendingRedeems),
        }
    }
}

impl Contract {
    fn assert_active(&self) {
        assert!(!self.config.paused, "paused");
    }
    fn assert_owner(&self) {
        assert_one_yocto();
        assert_eq!(env::predecessor_account_id(), self.owner, "owner only");
    }
    fn invoice(&self, id: &str) -> Invoice {
        self.invoices
            .get(&id.to_string())
            .unwrap_or_else(|| env::panic_str("invoice not found"))
    }
    fn buyer(&self, account: &AccountId) -> BuyerRecord {
        self.buyers.get(account).unwrap_or_default()
    }
    fn send_usdc(&self, to: AccountId, amount: u128) -> Promise {
        ext_usdc::ext(self.config.usdc.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(config::TRANSFER_GAS_TGAS))
            .with_unused_gas_weight(0)
            .ft_transfer(to, U128(amount), None)
    }
    fn callback_gas() -> Gas {
        Gas::from_tgas(config::CALLBACK_GAS_TGAS)
    }
    fn promise_succeeded() -> bool {
        env::promise_results_count() == 1 && env::promise_result_checked(0, 1024).is_ok()
    }
}

#[cfg(test)]
mod tests;
