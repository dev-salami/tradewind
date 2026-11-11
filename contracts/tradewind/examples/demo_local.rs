//! Local sandbox only. Shared helpers keep this executable aligned with tests.
#[path = "../tests/common/mod.rs"]
mod common;

use anyhow::{ensure, Result};
use common::{amount, Harness, USDC};
use serde_json::json;

fn fixed(value: u128, decimals: u32) -> String {
    let scale = 10_u128.pow(decimals);
    format!(
        "{}.{:0width$}",
        value / scale,
        value % scale,
        width = decimals as usize,
    )
}

fn dollars(value: u128) -> String {
    fixed((value + 5_000) / 10_000, 2)
}

fn price(value: u128) -> String {
    fixed((value + 50) / 100, 4)
}

#[tokio::main]
async fn main() -> Result<()> {
    println!("Starting a local sandbox; no wallet, keys, or public RPC required.");
    let h = Harness::new().await?;
    println!(
        "[1] Deployed Tradewind core + test USDC on a local NEAR sandbox \
         (demo clock: 1 contract day = 1 s)"
    );
    let start_pool = h.pool().await?;
    let shares = h.token_balance(&h.core, h.lp.id().as_str()).await?;
    println!(
        "[2] LP deposited {} USDC → {} twPOOL (share price {})",
        dollars(amount(&start_pool, "idle")),
        fixed(shares, 6),
        price(amount(&start_pool, "share_price_e6")),
    );
    h.seed_record().await?;
    println!(
        "[3] Four real $1.00 seed invoices were accepted and repaid on time \
         → gulf-foods score 12, advance rate 82%"
    );
    let invoice = h.create(&h.exporter, &h.buyer, 10 * USDC, 60).await?;
    let id = invoice["id"].as_str().unwrap();
    let hash = invoice["terms_hash"].as_str().unwrap();
    println!(
        "[4] sample-cashew created {id} for gulf-foods: $10.00, Net 60 (terms {}…{})",
        &hash[..4],
        &hash[hash.len() - 4..],
    );
    h.verify(&invoice).await?;
    println!(
        "[5] NEAR AI verdict recorded: pass (MOCK in local demo only — \
         the hosted app uses NEAR AI Cloud TEE). No AI service was called."
    );
    h.accept(&h.buyer, &invoice).await?;
    ensure!(
        h.nft_owner(id).await? == h.exporter.id().as_str(),
        "NFT not minted to exporter"
    );
    println!(
        "[6] gulf-foods accepted the exact terms with 1 yoctoNEAR \
         → invoice NFT belongs to sample-cashew"
    );
    let preview = h.view("preview_advance", json!({"id": id})).await?;
    ensure!(preview["eligible"] == true, "advance is ineligible: {preview}");
    let advance = amount(&preview, "advance");
    let exporter_before = h.balance(&h.exporter).await?;
    let treasury_before = h.balance(&h.treasury).await?;
    h.advance(&h.exporter, &invoice, advance).await?;
    ensure!(
        h.balance(&h.exporter).await? == exporter_before + advance,
        "advance not paid"
    );
    ensure!(h.nft_owner(id).await? == h.core.id().as_str(), "NFT not escrowed");
    println!(
        "[7] Exporter received {} USDC at {}%; NFT escrowed by core, status Funded",
        dollars(advance),
        preview["rate_bps"].as_u64().unwrap() / 100,
    );
    h.repay(&h.buyer, id, 6 * USDC, "demo-payment-1").await?;
    println!("[8] Buyer paid $6.00 → $6.00 pool principal, status PartiallyPaid");
    h.repay(&h.buyer, id, 4 * USDC, "demo-payment-2").await?;
    let repaid = h.invoice(id).await?;
    ensure!(repaid["status"] == "Repaid", "repayment did not complete");
    let paid = &repaid["paid"];
    let treasury_delta = h.balance(&h.treasury).await? - treasury_before;
    let exporter_rest = h.balance(&h.exporter).await? - exporter_before - advance;
    ensure!(treasury_delta == amount(paid, "to_protocol"), "treasury payout mismatch");
    ensure!(exporter_rest == amount(paid, "to_exporter"), "exporter payout mismatch");
    println!(
        "[9] Buyer paid $4.00 → remaining principal {}, pool fee {}, treasury {}, exporter {} USDC",
        dollars(advance - 6 * USDC),
        dollars(amount(paid, "to_pool_fee")),
        dollars(treasury_delta),
        dollars(exporter_rest),
    );
    ensure!(h.nft_owner(id).await? == h.exporter.id().as_str(), "NFT not returned");
    println!("[10] Invoice Repaid → NFT returned to sample-cashew");
    let record = h.record(&h.buyer).await?;
    let end_pool = h.pool().await?;
    ensure!(record["score"] == 15, "repayment missed the on-time window");
    println!(
        "[11] Repaid on time → buyer score 12 → {}, next advance rate {}%; share price {} → {}",
        record["score"],
        record["rate_bps"].as_u64().unwrap() / 100,
        price(amount(&start_pool, "share_price_e6")),
        price(amount(&end_pool, "share_price_e6")),
    );
    let lp_before = h.balance(&h.lp).await?;
    h.call(&h.lp, &h.core, "redeem", json!({"shares": shares.to_string()}), 1).await?;
    let redeemed = h.balance(&h.lp).await? - lp_before;
    println!(
        "[12] LP burned {} twPOOL and received {} USDC ({} base units, including earned fees)",
        fixed(shares, 6),
        dollars(redeemed),
        redeemed,
    );
    println!("Local demo complete. Test faucet token only; nothing was deployed to a public network.");
    Ok(())
}
