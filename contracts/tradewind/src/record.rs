use crate::*;
use crate::{events::emit, math};
use near_sdk::serde_json::json;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct BuyerRecord {
    pub accepted: u64,
    pub repaid_on_time: u64,
    pub repaid_grace: u64,
    pub repaid_late: u64,
    pub defaulted: u64,
    pub recovered: u64,
    pub repaid_volume: U128,
    pub open_principal: U128,
    pub score: i32,
    pub frozen: bool,
    pub last_update: U64,
}
impl BuyerRecord {
    pub fn record_default(&mut self, cfg: &Config, now: u64) -> i32 {
        self.defaulted = self.defaulted.saturating_add(1);
        self.frozen = true;
        self.score = self.score.saturating_add(cfg.score_default);
        self.last_update = U64(now);
        cfg.score_default
    }
    pub fn record_repayment(&mut self, face: u128, outcome: &str, cfg: &Config, now: u64) -> i32 {
        let delta = match outcome {
            "on_time" => {
                self.repaid_on_time = self.repaid_on_time.saturating_add(1);
                cfg.score_on_time
            }
            "grace" => {
                self.repaid_grace = self.repaid_grace.saturating_add(1);
                cfg.score_grace
            }
            "late" => {
                self.repaid_late = self.repaid_late.saturating_add(1);
                cfg.score_late
            }
            "after_default" => {
                self.recovered = self.recovered.saturating_add(1);
                0
            }
            _ => unreachable!("invalid repayment outcome"),
        };
        self.score = self.score.saturating_add(delta);
        self.repaid_volume.0 = self.repaid_volume.0.saturating_add(face);
        self.last_update = U64(now);
        delta
    }
}
impl Contract {
    pub(crate) fn counts(&self, i: &Invoice) -> bool {
        i.face.0 >= self.config.min_counted_face.0 && i.exporter != i.buyer
    }
    pub(crate) fn emit_record(&self, i: &Invoice, b: &BuyerRecord, delta: i32) {
        emit(
            "buyer_record_updated",
            json!({"invoice_id":i.id,"buyer":i.buyer,"delta":delta,"score":b.score,"rate_bps":math::advance_rate(b,&self.config)}),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scoring_table() {
        let c = Config::demo_default();
        let mut b = BuyerRecord::default();
        for _ in 0..3 {
            assert_eq!(b.record_repayment(2_000_000, "on_time", &c, 0), 3);
        }
        assert_eq!(b.record_repayment(2_000_000, "grace", &c, 0), 1);
        assert_eq!(
            (b.score, b.repaid_on_time, b.repaid_grace, b.repaid_volume.0),
            (10, 3, 1, 8_000_000)
        );
        assert_eq!(b.record_repayment(1_000_000, "late", &c, 0), -3);
        assert_eq!(b.record_default(&c, 0), -15);
        assert_eq!((b.score, b.defaulted, b.frozen), (-8, 1, true));
        assert_eq!(b.record_repayment(1_000_000, "after_default", &c, 0), 0);
        assert_eq!((b.score, b.recovered, b.frozen), (-8, 1, true));
    }
}
