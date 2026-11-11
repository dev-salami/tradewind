use crate::{
    config::{Config, BPS, USDC_SCALE},
    invoice::{AdvanceTerms, PaidState},
    record::BuyerRecord,
};
use near_sdk::{json_types::U128, near};
use uint::construct_uint;

construct_uint! { pub struct U256(4); }

fn narrow(n: U256) -> u128 {
    assert!(n <= U256::from(u128::MAX), "math overflow");
    n.low_u128()
}
pub fn mul_div_floor(a: u128, b: u128, d: u128) -> u128 {
    assert!(d > 0, "division by zero");
    narrow(U256::from(a) * U256::from(b) / U256::from(d))
}
pub fn mul_div_ceil(a: u128, b: u128, d: u128) -> u128 {
    checked_mul_div_ceil(a, b, d).expect("math overflow")
}
fn checked_mul_div_ceil(a: u128, b: u128, d: u128) -> Option<u128> {
    assert!(d > 0, "division by zero");
    let n = U256::from(a) * U256::from(b);
    let d = U256::from(d);
    let q = n / d
        + if n % d == U256::zero() {
            U256::zero()
        } else {
            U256::one()
        };
    (q <= U256::from(u128::MAX)).then(|| q.low_u128())
}
pub fn periods(tenor_days: u32, cfg: &Config) -> u128 {
    mul_div_ceil(u128::from(tenor_days), 1, u128::from(cfg.fee_period_days))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Terms {
    pub advance: u128,
    pub pool_fee: u128,
    pub protocol_fee: u128,
    pub exporter_rest: u128,
}
pub fn advance_terms(face: u128, tenor: u32, rate: u32, cfg: &Config) -> Option<Terms> {
    if u128::from(rate) > BPS {
        return None;
    }
    let advance = mul_div_floor(face, rate.into(), BPS);
    let pool_fee = checked_mul_div_ceil(
        face,
        u128::from(cfg.pool_fee_bps_per_30d) * periods(tenor, cfg),
        BPS,
    )?;
    let protocol_fee = checked_mul_div_ceil(face, cfg.protocol_fee_bps.into(), BPS)?;
    let exporter_rest = face
        .checked_sub(advance)?
        .checked_sub(pool_fee)?
        .checked_sub(protocol_fee)?;
    Some(Terms {
        advance,
        pool_fee,
        protocol_fee,
        exporter_rest,
    })
}
pub fn advance_rate(rec: &BuyerRecord, cfg: &Config) -> u32 {
    if rec.frozen || rec.score < 0 {
        return 0;
    }
    (u64::from(cfg.base_rate_bps)
        + (rec.score.min(cfg.score_cap) as u64) * u64::from(cfg.rate_step_bps))
    .min(u64::from(cfg.max_rate_bps)) as u32
}
pub fn buyer_limit(rec: &BuyerRecord, cfg: &Config) -> u128 {
    cfg.base_buyer_limit.0.saturating_add(mul_div_floor(
        rec.repaid_volume.0,
        cfg.limit_from_volume_bps.into(),
        BPS,
    ))
}
// U256 also handles the virtual +1 at u128::MAX, without overflow.
pub fn shares_for_deposit(amount: u128, assets: u128, supply: u128) -> u128 {
    narrow(
        U256::from(amount) * (U256::from(supply) + U256::one())
            / (U256::from(assets) + U256::one()),
    )
}
pub fn usdc_for_redeem(shares: u128, assets: u128, supply: u128) -> u128 {
    narrow(
        U256::from(shares) * (U256::from(assets) + U256::one())
            / (U256::from(supply) + U256::one()),
    )
}
pub fn share_price_e6(assets: u128, supply: u128) -> u128 {
    usdc_for_redeem(USDC_SCALE, assets, supply)
}

#[near(serializers = [json])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Waterfall {
    pub to_pool_principal: U128,
    pub to_pool_fee: U128,
    pub to_protocol: U128,
    pub to_exporter: U128,
    pub overpaid: U128,
}
pub fn apply_waterfall(
    face: u128,
    advance: Option<&AdvanceTerms>,
    paid: &PaidState,
    amount: u128,
) -> Waterfall {
    fn take(rem: &mut u128, due: u128, already: u128) -> U128 {
        let x = (*rem).min(due.saturating_sub(already));
        *rem -= x;
        U128(x)
    }
    let mut rem = amount;
    let mut s = Waterfall::default();
    if let Some(a) = advance {
        s.to_pool_principal = take(&mut rem, a.amount.0, paid.to_pool_principal.0);
        s.to_pool_fee = take(&mut rem, a.pool_fee.0, paid.to_pool_fee.0);
        s.to_protocol = take(&mut rem, a.protocol_fee.0, paid.to_protocol.0);
        let rest = face
            .saturating_sub(a.amount.0)
            .saturating_sub(a.pool_fee.0)
            .saturating_sub(a.protocol_fee.0);
        s.to_exporter = take(&mut rem, rest, paid.to_exporter.0);
    } else {
        s.to_exporter = take(&mut rem, face, paid.to_exporter.0);
    }
    s.overpaid = U128(rem);
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::json_types::U64;

    #[test]
    fn fee_table_and_rounding() {
        let c = Config::demo_default();
        for (face, rate, a, f, p, r) in [
            (
                12_000_000_000,
                8000,
                9_600_000_000,
                180_000_000,
                60_000_000,
                2_160_000_000,
            ),
            (10_000_000, 8000, 8_000_000, 150_000, 50_000, 1_800_000),
            (10_000_000, 7000, 7_000_000, 150_000, 50_000, 2_800_000),
            (10_000_000, 8500, 8_500_000, 150_000, 50_000, 1_300_000),
        ] {
            assert_eq!(
                advance_terms(face, 60, rate, &c),
                Some(Terms {
                    advance: a,
                    pool_fee: f,
                    protocol_fee: p,
                    exporter_rest: r
                })
            );
        }
        assert_eq!(periods(31, &c), 2);
        assert_eq!(periods(30, &c), 1);
        assert_eq!(mul_div_ceil(1, 1, 10_000), 1);
        assert_eq!(mul_div_floor(u128::MAX, u128::MAX, u128::MAX), u128::MAX);
        assert_eq!(mul_div_ceil(u128::MAX, u128::MAX, u128::MAX), u128::MAX);
        assert!(advance_terms(1, 365, 8500, &c).is_none());
    }
    #[test]
    fn rates_and_limits() {
        let c = Config::demo_default();
        let mut b = BuyerRecord::default();
        for (s, rate) in [
            (0, 7000),
            (10, 8000),
            (13, 8300),
            (15, 8500),
            (100, 8500),
            (-1, 0),
        ] {
            b.score = s;
            assert_eq!(advance_rate(&b, &c), rate);
        }
        b.score = 15;
        b.frozen = true;
        assert_eq!(advance_rate(&b, &c), 0);
        b.repaid_volume = U128(8_000_000);
        assert_eq!(buyer_limit(&b, &c), 14_000_000);
    }
    #[test]
    fn virtual_shares_and_price() {
        assert_eq!(shares_for_deposit(20_000_000, 0, 0), 20_000_000);
        assert_eq!(share_price_e6(20_000_000, 20_000_000), 1_000_000);
        assert_eq!(share_price_e6(20_150_000, 20_000_000), 1_007_499);
        assert_eq!(shares_for_deposit(1, 0, 0), 1);
        assert_eq!(shares_for_deposit(20_000_000, 1, 1), 20_000_000);
        assert_eq!(
            usdc_for_redeem(20_000_000, 20_000_001, 20_000_001),
            20_000_000
        );
        assert_eq!(
            shares_for_deposit(u128::MAX, u128::MAX, u128::MAX),
            u128::MAX
        );
    }
    #[test]
    fn partial_waterfall() {
        let a = AdvanceTerms {
            rate_bps: 8000,
            amount: U128(8_000_000),
            pool_fee: U128(150_000),
            protocol_fee: U128(50_000),
            at: U64(0),
        };
        let mut p = PaidState::default();
        let s = apply_waterfall(10_000_000, Some(&a), &p, 6_000_000);
        assert_eq!(s.to_pool_principal.0, 6_000_000);
        assert_eq!(s.to_exporter.0, 0);
        p.to_pool_principal = s.to_pool_principal;
        let s = apply_waterfall(10_000_000, Some(&a), &p, 4_000_000);
        assert_eq!(
            (
                s.to_pool_principal.0,
                s.to_pool_fee.0,
                s.to_protocol.0,
                s.to_exporter.0,
                s.overpaid.0
            ),
            (2_000_000, 150_000, 50_000, 1_800_000, 0)
        );
        let s = apply_waterfall(10_000_000, None, &PaidState::default(), 11_000_000);
        assert_eq!((s.to_exporter.0, s.overpaid.0), (10_000_000, 1_000_000));
    }

    #[test]
    fn waterfall_conserves_every_unit_and_locks_tranche_caps() {
        let cfg = Config::demo_default();
        for rate in [7000, 8000, 8500] {
            let terms = advance_terms(10_000_000, 60, rate, &cfg).unwrap();
            let a = AdvanceTerms {
                rate_bps: rate,
                amount: U128(terms.advance),
                pool_fee: U128(terms.pool_fee),
                protocol_fee: U128(terms.protocol_fee),
                at: U64(0),
            };
            let mut p = PaidState::default();
            for amount in [1, 999_999, 5_000_000, 4_000_000, 123_456] {
                let s = apply_waterfall(10_000_000, Some(&a), &p, amount);
                assert_eq!(
                    s.to_pool_principal.0
                        + s.to_pool_fee.0
                        + s.to_protocol.0
                        + s.to_exporter.0
                        + s.overpaid.0,
                    amount
                );
                p.total.0 += amount;
                p.to_pool_principal.0 += s.to_pool_principal.0;
                p.to_pool_fee.0 += s.to_pool_fee.0;
                p.to_protocol.0 += s.to_protocol.0;
                p.to_exporter.0 += s.to_exporter.0;
                p.overpaid.0 += s.overpaid.0;
            }
            assert_eq!(p.to_pool_principal.0, terms.advance);
            assert_eq!(p.to_pool_fee.0, terms.pool_fee);
            assert_eq!(p.to_protocol.0, terms.protocol_fee);
            assert_eq!(p.to_exporter.0, terms.exporter_rest);
            assert_eq!(p.overpaid.0, 123_456);
        }
    }
}
