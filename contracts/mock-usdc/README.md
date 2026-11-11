# Mock USDC

testnet faucet token, never deploy to mainnet

NEP-141 / NEP-145 token with six decimals. Anyone can call
`mint(account_id, amount)` for up to 1,000 tUSDC (`"1000000000"` base units)
per call. The receiver must already be storage-registered, or the caller must
attach at least `storage_balance_bounds().min`; excess deposit is refunded to
the caller. This public faucet has no scarcity or monetary value.
