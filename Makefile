# Linux prerequisites: OpenSSL headers (libssl-dev) and normally pkg-config.
# If pkg-config is absent, export OPENSSL_LIB_DIR and OPENSSL_INCLUDE_DIR
# to the system OpenSSL library/header directories before running these targets.
.PHONY: build test unit demo fmt clippy

build:
	cd contracts/tradewind && cargo near build non-reproducible-wasm --no-abi
	cd contracts/mock-usdc && cargo near build non-reproducible-wasm --no-abi

test: build
	cargo test --workspace

unit:
	cargo test --workspace --lib

demo: build
	cargo run --release -p tradewind --example demo_local

fmt:
	cargo fmt --all

clippy:
	cargo clippy --workspace --all-targets -- -D warnings
