use crate::{invoice::Verification, *};

fn hex_bytes(value: &str) -> Option<Vec<u8>> {
    if !value.len().is_multiple_of(2) || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|n| u8::from_str_radix(&value[n..n + 2], 16).ok())
        .collect()
}

pub(crate) fn normalise_address(address: &str) -> Option<String> {
    let address = address.to_ascii_lowercase();
    let hex = address.strip_prefix("0x")?;
    (hex.len() == 40 && hex_bytes(hex).is_some()).then_some(address)
}

impl Contract {
    pub(crate) fn check_tee_signature(&self, v: &Verification) {
        assert_eq!(v.signing_algo, "ecdsa", "tee signature invalid");
        let signature = hex_bytes(v.signature.strip_prefix("0x").unwrap_or(&v.signature))
            .filter(|s| s.len() == 65)
            .unwrap_or_else(|| env::panic_str("tee signature invalid"));
        let recovery = match signature[64] {
            0 | 1 => signature[64],
            27 | 28 => signature[64] - 27,
            _ => env::panic_str("tee signature invalid"),
        };
        let message = format!("{}:{}:{}", v.model_id, v.request_hash, v.response_hash);
        let payload = format!("\x19Ethereum Signed Message:\n{}{}", message.len(), message);
        let digest = env::keccak256(payload.as_bytes());
        let public_key = env::ecrecover(&digest, &signature[..64], recovery, true)
            .unwrap_or_else(|| env::panic_str("tee signature invalid"));
        let hash = env::keccak256(public_key);
        let recovered = format!(
            "0x{}",
            hash[12..]
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        );
        let claimed = normalise_address(&v.signing_address)
            .unwrap_or_else(|| env::panic_str("tee signature invalid"));
        assert_eq!(recovered, claimed, "tee signature invalid");
        assert!(
            self.tee_signers.contains(&recovered),
            "tee signer not allowlisted"
        );
    }
}
