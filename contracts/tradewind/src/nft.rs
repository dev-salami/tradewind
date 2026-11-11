use crate::*;
use near_contract_standards::non_fungible_token::{
    events::{NftBurn, NftTransfer},
    metadata::{NFTContractMetadata, TokenMetadata},
    NonFungibleTokenEnumeration, Token,
};
use near_sdk::serde_json::json;

impl Contract {
    pub(crate) fn burn_invoice_nft(&mut self, id: &str) {
        let token_id = id.to_string();
        let Some(owner_id) = self.nft.owner_by_id.get(&token_id) else {
            return;
        };
        // Metadata/approvals are disabled at initialization; only ownership and
        // owner enumeration need removal. owner_by_id also drives total supply.
        self.nft.owner_by_id.remove(&token_id);
        if let Some(by_owner) = &mut self.nft.tokens_per_owner {
            let mut tokens = by_owner.get(&owner_id).expect("NFT enumeration invariant");
            tokens.remove(&token_id);
            if tokens.is_empty() {
                by_owner.remove(&owner_id);
            } else {
                by_owner.insert(&owner_id, &tokens);
            }
        }
        NftBurn {
            owner_id: &owner_id,
            token_ids: &[id],
            authorized_id: None,
            memo: Some("invoice cancelled"),
        }
        .emit();
    }
    pub(crate) fn move_nft(&mut self, id: &str, from: &AccountId, to: &AccountId) {
        if from == to {
            return;
        }
        let token_id = id.to_string();
        assert_eq!(
            self.nft.owner_by_id.get(&token_id).as_ref(),
            Some(from),
            "NFT ownership invariant"
        );
        self.nft.internal_transfer_unguarded(&token_id, from, to);
        NftTransfer {
            old_owner_id: from,
            new_owner_id: to,
            token_ids: &[id],
            authorized_id: None,
            memo: None,
        }
        .emit();
    }
}

#[near]
impl Contract {
    pub fn nft_token(&self, token_id: String) -> Option<Token> {
        let owner_id = self.nft.owner_by_id.get(&token_id)?;
        let i = self.invoices.get(&token_id)?;
        let verification = i
            .verification
            .as_ref()
            .map(|v| json!({"model_id":v.model_id,"signature":v.signature}));
        let metadata=TokenMetadata {
            title:Some(format!("Tradewind invoice {}",i.id)),
            description:Some(format!("Tradewind invoice · {}",i.buyer_label)),
            media:Some(crate::visual::invoice_media(&i)),
            extra:Some(json!({"face":i.face,"due_at":i.due_at,"buyer":i.buyer,"doc_hash":i.doc_hash,"status":i.status,"verification":verification}).to_string()),
            copies:Some(1), ..TokenMetadata::default()
        };
        Some(Token {
            token_id,
            owner_id,
            metadata: Some(metadata),
            approved_account_ids: None,
        })
    }
    pub fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: "nft-2.0.0".into(),
            name: "Tradewind Invoices".into(),
            symbol: "TWINV".into(),
            icon: Some(crate::visual::icon()),
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
    pub fn nft_total_supply(&self) -> U128 {
        self.nft.nft_total_supply()
    }
    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        if limit == Some(0) || from_index.unwrap_or(U128(0)).0 >= self.nft_total_supply().0 {
            return vec![];
        }
        self.nft
            .nft_tokens(from_index, Some(limit.unwrap_or(50).min(100)))
            .into_iter()
            .filter_map(|t| self.nft_token(t.token_id))
            .collect()
    }
    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.nft.nft_supply_for_owner(account_id)
    }
    pub fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        if limit == Some(0)
            || from_index.unwrap_or(U128(0)).0 >= self.nft_supply_for_owner(account_id.clone()).0
        {
            return vec![];
        }
        self.nft
            .nft_tokens_for_owner(account_id, from_index, Some(limit.unwrap_or(50).min(100)))
            .into_iter()
            .filter_map(|t| self.nft_token(t.token_id))
            .collect()
    }
    #[payable]
    pub fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        let _ = (receiver_id, token_id, approval_id, memo);
        env::panic_str("Transfers disabled in MVP");
    }
    #[payable]
    pub fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        let _ = (receiver_id, token_id, approval_id, memo, msg);
        env::panic_str("Transfers disabled in MVP");
    }
    #[payable]
    pub fn nft_approve(&mut self, token_id: String, account_id: AccountId, msg: Option<String>) {
        let _ = (token_id, account_id, msg);
        env::panic_str("Transfers disabled in MVP");
    }
}
