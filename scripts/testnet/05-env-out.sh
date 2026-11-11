#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"

step 'Print non-secret web and worker environment values. Nothing is written, even with DRY_RUN=0.'
cat <<EOF
# Shared web/API and worker configuration
NEAR_NETWORK=testnet
NEAR_RPC_URL=https://rpc.testnet.near.org
CORE_CONTRACT_ID=$CORE
USDC_CONTRACT_ID=$USDC
ATTESTER_ACCOUNT_ID=$ATTESTER
KEEPER_ACCOUNT_ID=$KEEPER
BOT_ACCOUNT_ID=$BOT
TREASURY_ACCOUNT_ID=$TREASURY
OWNER_ACCOUNT_ID=$ROOT
# Web client (public)
NEXT_PUBLIC_NEAR_NETWORK=testnet
NEXT_PUBLIC_CORE_CONTRACT_ID=$CORE
NEXT_PUBLIC_USDC_CONTRACT_ID=$USDC
NEXT_PUBLIC_DATA_SOURCE=rpc
# Sample testnet wallets (not service credentials)
EXPORTER_ACCOUNT_ID=$EXPORTER
BUYER_ACCOUNT_ID=$BUYER
BUYER2_ACCOUNT_ID=$BUYER2
LP_ACCOUNT_ID=$LP
# Secret variable NAMES only: configure separately in a secret manager.
# ATTESTER_PRIVATE_KEY
# KEEPER_PRIVATE_KEY
# OWNER_PRIVATE_KEY (worker cancellation of Accepted guided invoices only)
# BOT_PRIVATE_KEY
# NEARAI_API_KEY
# TELEGRAM_BOT_TOKEN
# TELEGRAM_WEBHOOK_SECRET
# DATABASE_URL
# SESSION_SECRET
# Optional Path B only: RELAYER_ACCOUNT_ID, RELAYER_PRIVATE_KEY
# Other deployment-specific names: PUBLIC_BASE_URL, NEARAI_MODEL_TEXT,
# NEARAI_MODEL_VISION, ONECLICK_BASE_URL, ONECLICK_JWT (optional)
EOF
