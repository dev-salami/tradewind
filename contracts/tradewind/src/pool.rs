use crate::*;
use crate::{events::emit, math};
use near_sdk::serde_json::json;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct Pool {
    pub idle: U128, pub outstanding_principal: U128, pub written_off: U128,
    pub fees_earned: U128, pub protocol_fees_paid: U128,
}
impl Pool {
    pub fn total_assets(&self) -> u128 { self.idle.0.checked_add(self.outstanding_principal.0).expect("assets overflow") }
}

impl Contract {
    pub(crate) fn deposit(&mut self, account: &AccountId, amount: u128) -> u128 {
        if self.config.paused || !self.lp_allowlist.contains(account) || amount==0 { return amount; }
        let assets=self.pool.total_assets();
        if assets.checked_add(amount).is_none() { return amount; }
        // Price can be tiny after a write-off; refuse unrepresentable share mints.
        let n=math::U256::from(amount)*(math::U256::from(self.shares.total_supply)+math::U256::one())/(math::U256::from(assets)+math::U256::one());
        if n>math::U256::from(u128::MAX) { return amount; }
        let shares=n.low_u128();
        if shares==0 || self.shares.total_supply.checked_add(shares).is_none() { return amount; }
        self.mint_shares(account,shares,"pool deposit"); self.pool.idle.0+=amount;
        emit("pool_deposit",json!({"account_id":account,"amount":U128(amount),"shares":U128(shares)}));
        0
    }
}

#[near]
impl Contract {
    #[payable]
    pub fn redeem(&mut self, shares: U128) -> Promise {
        assert_one_yocto();
        assert!(shares.0>0,"zero shares");
        let caller=env::predecessor_account_id();
        let usdc=math::usdc_for_redeem(shares.0,self.pool.total_assets(),self.shares.total_supply);
        assert!(usdc>0 && usdc<=self.pool.idle.0,"liquidity in advances");
        self.burn_shares(&caller,shares.0,"pool redeem");
        self.pool.idle.0-=usdc;
        let pending=self.pending_redeems.get(&caller).unwrap_or(0).checked_add(1).expect("too many redemptions");
        self.pending_redeems.insert(&caller,&pending);
        emit("pool_redeem",json!({"account_id":caller,"shares":shares,"usdc":U128(usdc)}));
        self.send_usdc(caller.clone(),usdc).then(Self::ext(env::current_account_id())
            .with_static_gas(Self::callback_gas()).with_unused_gas_weight(0).on_redeem(caller,shares,U128(usdc)))
    }

    #[private]
    pub fn on_redeem(&mut self, account: AccountId, shares: U128, usdc: U128) -> bool {
        let pending=self.pending_redeems.get(&account).unwrap_or(0);
        assert!(pending>0,"no pending redemption");
        if pending==1 { self.pending_redeems.remove(&account); } else { self.pending_redeems.insert(&account,&(pending-1)); }
        let success=Self::promise_succeeded();
        if !success {
            self.mint_shares(&account,shares.0,"redeem reverted");
            self.pool.idle.0=self.pool.idle.0.checked_add(usdc.0).expect("pool overflow");
            emit("pool_redeem_reverted",json!({"account_id":account,"shares":shares,"usdc":usdc}));
        }
        success
    }
}
