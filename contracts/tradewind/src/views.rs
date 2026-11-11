use crate::*;
use crate::{invoice::terms_hash, math, config::BPS};

#[near(serializers = [json])]
pub struct AdvancePreview {
    pub rate_bps: u32, pub advance: U128, pub pool_fee: U128, pub protocol_fee: U128,
    pub exporter_rest: U128, pub eligible: bool, pub reason: Option<String>,
}
#[near(serializers = [json])]
pub struct PoolView {
    pub idle: U128, pub outstanding_principal: U128, pub written_off: U128,
    pub total_assets: U128, pub total_shares: U128, pub share_price_e6: U128,
    pub fees_earned: U128, pub protocol_fees_paid: U128,
}
#[near(serializers = [json])]
pub struct BuyerRecordView {
    #[serde(flatten)]
    pub record: BuyerRecord,
    pub rate_bps: u32, pub buyer_limit: U128,
}
#[near(serializers = [json])]
pub struct Roles {
    pub owner: AccountId, pub treasury: AccountId, pub attester: AccountId,
    pub keeper: AccountId, pub relayer: Option<AccountId>,
}

#[near]
impl Contract {
    pub fn get_invoice(&self, id: String) -> Option<Invoice> { self.invoices.get(&id) }
    pub fn list_invoices(&self, from_index: Option<U64>, limit: Option<u64>) -> Vec<Invoice> {
        let start=from_index.unwrap_or(U64(0)).0.min(self.invoice_ids.len());
        let end=start.saturating_add(limit.unwrap_or(50).min(100)).min(self.invoice_ids.len());
        (start..end).filter_map(|n|self.invoice_ids.get(n).and_then(|id|self.invoices.get(&id))).collect()
    }
    pub fn invoices_by_exporter(&self, account_id: AccountId) -> Vec<Invoice> {
        self.invoices_by_exporter.get(&account_id).map(|set|set.iter().filter_map(|id|self.invoices.get(id)).collect()).unwrap_or_default()
    }
    pub fn invoices_by_buyer(&self, account_id: AccountId) -> Vec<Invoice> {
        self.invoices_by_buyer.get(&account_id).map(|set|set.iter().filter_map(|id|self.invoices.get(id)).collect()).unwrap_or_default()
    }
    pub fn get_buyer_record(&self, account_id: AccountId) -> BuyerRecordView {
        let b=self.buyer(&account_id);
        BuyerRecordView {rate_bps:math::advance_rate(&b,&self.config),buyer_limit:U128(math::buyer_limit(&b,&self.config)),record:b}
    }
    pub fn preview_advance(&self, id: String) -> AdvancePreview {
        let mut p=AdvancePreview {rate_bps:0,advance:U128(0),pool_fee:U128(0),protocol_fee:U128(0),exporter_rest:U128(0),eligible:false,reason:None};
        let Some(i)=self.invoices.get(&id) else {p.reason=Some("invoice not found".into());return p;};
        let b=self.buyer(&i.buyer); p.rate_bps=math::advance_rate(&b,&self.config);
        let terms=math::advance_terms(i.face.0,i.tenor_days,p.rate_bps,&self.config);
        if let Some(t)=&terms {p.advance=U128(t.advance);p.pool_fee=U128(t.pool_fee);p.protocol_fee=U128(t.protocol_fee);p.exporter_rest=U128(t.exporter_rest);}
        let reason=if self.config.paused {Some("paused")}
            else if i.status!=InvoiceStatus::Accepted {Some("invalid status")}
            else if !i.verification.as_ref().is_some_and(|v|v.verdict=="pass") {Some("verification required")}
            else if i.due_at.is_none_or(|d|env::block_timestamp()>=d.0) {Some("invoice due")}
            else if p.rate_bps==0 {Some("buyer not eligible")}
            else if terms.is_none() {Some("fees exceed face")}
            else if b.open_principal.0.checked_add(p.advance.0).is_none_or(|n|n>math::buyer_limit(&b,&self.config)) {Some("buyer exposure")}
            else if p.advance.0>self.pool.idle.0 {Some("pool liquidity")}
            else if p.advance.0>math::mul_div_floor(self.pool.total_assets(),self.config.max_single_advance_bps.into(),BPS) {Some("single advance cap")}
            else if p.advance.0==0 {Some("zero advance")}
            else {None};
        p.reason=reason.map(str::to_string); p.eligible=p.reason.is_none(); p
    }
    pub fn get_pool(&self) -> PoolView {
        let assets=self.pool.total_assets();
        PoolView {idle:self.pool.idle,outstanding_principal:self.pool.outstanding_principal,written_off:self.pool.written_off,
            total_assets:U128(assets),total_shares:U128(self.shares.total_supply),share_price_e6:U128(math::share_price_e6(assets,self.shares.total_supply)),fees_earned:self.pool.fees_earned,protocol_fees_paid:self.pool.protocol_fees_paid}
    }
    pub fn preview_deposit(&self, amount: U128) -> U128 { U128(math::shares_for_deposit(amount.0,self.pool.total_assets(),self.shares.total_supply)) }
    pub fn preview_redeem(&self, shares: U128) -> U128 { U128(math::usdc_for_redeem(shares.0,self.pool.total_assets(),self.shares.total_supply)) }
    pub fn get_config(&self) -> Config { self.config.clone() }
    pub fn get_roles(&self) -> Roles { Roles {owner:self.owner.clone(),treasury:self.treasury.clone(),attester:self.attester.clone(),keeper:self.keeper.clone(),relayer:self.relayer.clone()} }
    pub fn get_claimable(&self, account_id: AccountId) -> U128 { U128(self.claimable.get(&account_id).unwrap_or(0)) }
    pub fn list_unattributed(&self, from_index: Option<U64>, limit: Option<u64>) -> Vec<StrayPayment> {
        let start=from_index.unwrap_or(U64(0)).0.min(self.unattributed.len());
        let end=start.saturating_add(limit.unwrap_or(50).min(100)).min(self.unattributed.len());
        (start..end).filter_map(|n|self.unattributed.get(n)).collect()
    }
    pub fn is_lp_allowed(&self, account_id: AccountId) -> bool { self.lp_allowlist.contains(&account_id) }
    pub fn get_approver(&self, exporter: AccountId) -> Option<AccountId> { self.approvers.get(&exporter) }
    pub fn now_contract_day(&self, id: String) -> Option<U64> {
        self.invoices.get(&id)?.accepted_at.map(|a|U64(env::block_timestamp().saturating_sub(a.0)/self.config.day_ns()))
    }
    pub fn compute_terms_hash(&self, exporter: AccountId, buyer: AccountId, invoice_number: String, face: U128, tenor_days: u32, doc_hash: String) -> String {
        terms_hash(&exporter,&buyer,&invoice_number,face.0,tenor_days,&doc_hash)
    }
}
