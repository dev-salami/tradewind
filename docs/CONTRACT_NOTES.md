# Tradewind contract polish

## Deployment and compatibility

- `require_tee_signature` defaults to `false` for mock/demo compatibility. **Mainnet should set it to `true`**, after the owner allowlists trusted TEE signing addresses. The attester role is still required. The check proves the allowlisted key signed the model/request/response tuple, not the invoice's business correctness or TEE attestation chain.
- `add_tee_signer`, `remove_tee_signer`, and `set_buyer_limit_override` require the owner and exactly 1 yoctoNEAR; each emits `admin_action`. Addresses are normalized to lowercase `0x` + 40 hexadecimal digits. `get_tee_signers` enumerates the set.
- Verification uses EIP-191 personal-sign over UTF-8 `model_id:request_hash:response_hash`, Keccak-256, and the runtime's `ecrecover` with malleability rejection. Input signatures are 65-byte hex, optionally `0x` prefixed, with recovery byte 0/1/27/28. The stored `signature_checked_on_chain` flag is always computed by the contract, never trusted from input.
- The new contract collections, config flag, and stored verification flag change **Borsh state layout**. JSON `serde(default)` supports older callers, not old persisted Borsh state. Use a fresh initialization or a separately reviewed explicit migration; do not upgrade an initialized contract blindly.
- Buyer overrides replace the computed exposure limit (including the volume increment); `None` restores the computed limit. An override does not bypass frozen/negative-score, liquidity, timing, or single-advance checks.

## Cancellation and metadata

- Exporters retain zero-deposit cancellation before acceptance (Created/Verified/Rejected). Owners may cancel these or Accepted invoices with exactly 1 yoctoNEAR, including while paused. Any advance, pending transfer, or payment-stage status blocks cancellation.
- Cancellation preserves the invoice and buyer record, burns an accepted invoice's NFT with `nep171/nft_burn`, updates enumeration, and emits `invoice_cancelled` (plus `admin_action` for owner cancellation). Keeper methods and payment application reject Cancelled status. Historical acceptance counts are not decremented.
- NFT media is generated from current invoice state on every view, never stored. SVGs include the mark geometry, ID, two-decimal USDC face, tenor, escaped/truncated buyer label, and live status. NFT and twPOOL contract icons share the same compact SVG data URI.

## Offline signature test-vector handoff

No Rust or Node toolchain is available on the editing machine. Three vector-dependent unit tests are explicitly ignored until the reviewer supplies `SIG_HEX` in `contracts/tradewind/src/tests.rs`.

On a machine with `viem` already installed, run (no RPC involved):

```sh
node contracts/tradewind/scripts/sign-test-vector.mjs
```

The script uses the requested well-known public test key, prints the address and signature, and does not make network calls. Confirm the address is `0x2c7536e3605d9c16a7a3d7b1898e529396a65c23`, paste the signature into `SIG_HEX`, remove the three `#[ignore]` attributes, then run the normal build/unit/sandbox checks. Never use this public key for funds.

Exact `MESSAGE` (146 UTF-8 bytes):

```text
verifiable-model:abababababababababababababababababababababababababababababababab:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd
```

Non-vector tests cover malformed signatures, input-flag spoofing with checks disabled, signer administration, view reasons, overrides, cancellation, and SVG content/size. Sandbox coverage includes exporter/owner cancellation, burn/supply, record preservation, override/reset, and reason strings.

Editing-machine validation: `git diff --check` passed. Offline Python checks parsed the generated SVG XML, confirmed media/icon size bounds and matching MESSAGE constants, and checked the changed-file scope. `cargo test -p tradewind --lib` and `cargo fmt --all -- --check` could not run (`cargo: command not found`); compilation, formatting, and sandbox execution remain reviewer checks.
