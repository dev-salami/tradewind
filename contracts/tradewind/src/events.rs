use near_sdk::{env, serde_json::{json, Value}};

pub fn emit(event: &str, data: Value) {
    env::log_str(&format!("EVENT_JSON:{}", json!({
        "standard": "tradewind", "version": "1.0.0", "event": event, "data": [data]
    })));
}
