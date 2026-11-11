use near_sdk::{json_types::U128, near, AccountId};

pub const NFT_MINT_RESERVE: u128 = 10_000_000_000_000_000_000_000;
pub const BPS: u128 = 10_000;
pub const NS_PER_SECOND: u64 = 1_000_000_000;
pub const USDC_SCALE: u128 = 1_000_000;
pub const TRANSFER_GAS_TGAS: u64 = 10;
pub const CALLBACK_GAS_TGAS: u64 = 15;
pub const MAX_PAYMENTS: usize = 20;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Config {
    pub usdc: AccountId,
    pub seconds_per_day: u32,
    pub fee_period_days: u32,
    pub base_rate_bps: u32,
    pub max_rate_bps: u32,
    pub rate_step_bps: u32,
    pub score_cap: i32,
    pub score_on_time: i32,
    pub score_grace: i32,
    pub score_late: i32,
    pub score_default: i32,
    pub pool_fee_bps_per_30d: u32,
    pub protocol_fee_bps: u32,
    pub grace_days: u32,
    pub default_after_days: u32,
    pub min_counted_face: U128,
    pub min_payment: U128,
    pub max_face: U128,
    pub base_buyer_limit: U128,
    pub limit_from_volume_bps: u32,
    pub max_single_advance_bps: u32,
    pub invoice_counter_start: u64,
    pub paused: bool,
}

impl Config {
    pub fn demo_default() -> Self {
        Self {
            usdc: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1".parse().unwrap(),
            seconds_per_day: 10, fee_period_days: 30,
            base_rate_bps: 7000, max_rate_bps: 8500, rate_step_bps: 100,
            score_cap: 15, score_on_time: 3, score_grace: 1, score_late: -3,
            score_default: -15, pool_fee_bps_per_30d: 75, protocol_fee_bps: 50,
            grace_days: 7, default_after_days: 30,
            min_counted_face: U128(1_000_000), min_payment: U128(1_000_000),
            max_face: U128(50_000_000), base_buyer_limit: U128(10_000_000),
            limit_from_volume_bps: 5000, max_single_advance_bps: 5000,
            invoice_counter_start: 35, paused: false,
        }
    }

    pub fn day_ns(&self) -> u64 { u64::from(self.seconds_per_day) * NS_PER_SECOND }

    pub fn validate(&self) {
        assert!(self.seconds_per_day > 0 && self.fee_period_days > 0, "invalid clock");
        assert!(self.base_rate_bps <= self.max_rate_bps && self.max_rate_bps <= 10_000, "invalid rates");
        assert!(self.max_single_advance_bps <= 10_000, "invalid pool cap");
        assert!(self.pool_fee_bps_per_30d <= 10_000 && self.protocol_fee_bps <= 10_000, "invalid fees");
        assert!(self.limit_from_volume_bps <= 10_000, "invalid volume limit");
        assert!(self.score_cap >= 0, "invalid score cap");
        assert!(self.score_on_time >= 0 && self.score_grace >= 0 && self.score_late <= 0 && self.score_default <= 0, "invalid score deltas");
        assert!(self.default_after_days >= self.grace_days, "invalid default period");
        assert!(self.min_payment.0 > 0 && self.min_counted_face.0 > 0 && self.max_face.0 > 0, "invalid amounts");
        let days = u64::from(self.default_after_days.max(self.grace_days)).max(365);
        assert!(self.day_ns().checked_mul(days).is_some(), "clock overflow");
    }
}
