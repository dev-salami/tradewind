// Helpers in `common` assert success before returning results.
#![allow(unused_must_use)]
mod common;

use anyhow::Result;
use common::{amount, assert_failure, Harness, USDC};
use near_workspaces::types::NearToken;
use serde_json::json;

#[tokio::test]
async fn happy_path_full_flow() -> Result<()> {
    let h = Harness::new().await?;
    // Four on-time seed invoices give score 12 and rate 82%, avoiding a narrow
    // one-second grace-window dependency. No privileged scoring shortcuts.
    h.seed_record().await?;
    let before_pool = h.pool().await?;
    let before_exporter = h.balance(&h.exporter).await?;
    let before_treasury = h.balance(&h.treasury).await?;
    let before_buyer = h.balance(&h.buyer).await?;
    let invoice = h.create(&h.exporter, &h.buyer, 10 * USDC, 60).await?;
    let id = invoice["id"].as_str().unwrap();
    h.verify(&invoice).await?;
    assert_eq!(h.invoice(id).await?["status"], "Verified");
    h.accept(&h.buyer, &invoice).await?;
    assert_eq!(h.nft_owner(id).await?, h.exporter.id().as_str());
    let preview = h.view("preview_advance", json!({"id": id})).await?;
    assert_eq!(preview["eligible"], true);
    assert_eq!(preview["rate_bps"], 8200);
    assert_eq!(amount(&preview, "advance"), 8_200_000);
    assert_eq!(amount(&preview, "pool_fee"), 150_000);
    assert_eq!(amount(&preview, "protocol_fee"), 50_000);
    h.advance(&h.exporter, &invoice, 8_200_000).await?;
    assert_eq!(h.balance(&h.exporter).await?, before_exporter + 8_200_000);
    assert_eq!(h.nft_owner(id).await?, h.core.id().as_str());
    assert_eq!(h.invoice(id).await?["status"], "Funded");
    h.repay(&h.buyer, id, 6 * USDC, "partial-1").await?;
    let partial = h.invoice(id).await?;
    assert_eq!(partial["status"], "PartiallyPaid");
    assert_eq!(amount(&partial["paid"], "to_pool_principal"), 6 * USDC);
    assert_eq!(amount(&partial["paid"], "to_protocol"), 0);
    assert_eq!(amount(&partial["paid"], "to_exporter"), 0);
    assert_eq!(h.balance(&h.treasury).await?, before_treasury);
    assert_eq!(h.balance(&h.exporter).await?, before_exporter + 8_200_000);
    let result = h.repay(&h.buyer, id, 4 * USDC, "partial-2").await?;
    assert!(result
        .logs()
        .iter()
        .any(|log| log.contains("\"outcome\":\"on_time\"")));
    let repaid = h.invoice(id).await?;
    assert_eq!(repaid["status"], "Repaid");
    assert_eq!(amount(&repaid["paid"], "to_pool_principal"), 8_200_000);
    assert_eq!(amount(&repaid["paid"], "to_pool_fee"), 150_000);
    assert_eq!(amount(&repaid["paid"], "to_protocol"), 50_000);
    assert_eq!(amount(&repaid["paid"], "to_exporter"), 1_600_000);
    assert_eq!(amount(&repaid["paid"], "overpaid"), 0);
    assert_eq!(repaid["payments"][0]["payment_ref"], "partial-1");
    assert_eq!(repaid["payments"][1]["payment_ref"], "partial-2");
    assert_eq!(h.balance(&h.treasury).await?, before_treasury + 50_000);
    assert_eq!(h.balance(&h.exporter).await?, before_exporter + 9_800_000);
    assert_eq!(h.balance(&h.buyer).await?, before_buyer - 10 * USDC);
    assert_eq!(h.nft_owner(id).await?, h.exporter.id().as_str());
    assert_eq!(h.record(&h.buyer).await?["score"], 15);
    let pool = h.pool().await?;
    assert_eq!(amount(&pool, "idle"), 20_150_000);
    assert_eq!(amount(&pool, "outstanding_principal"), 0);
    assert_eq!(amount(&pool, "fees_earned"), 150_000);
    assert_eq!(amount(&pool, "protocol_fees_paid"), 50_000);
    assert!(amount(&pool, "share_price_e6") > amount(&before_pool, "share_price_e6"));
    // Virtual +1 shares/assets make the exact price one unit below 1.007500.
    assert_eq!(amount(&pool, "share_price_e6"), 1_007_499);
    Ok(())
}

#[tokio::test]
async fn default_path() -> Result<()> {
    let h = Harness::new().await?;
    let initial_pool = h.pool().await?;
    let invoice = h.accepted(&h.exporter, &h.buyer2, 10 * USDC, 3).await?;
    let id = invoice["id"].as_str().unwrap();
    // Request immediately: the three-day tenor is three sandbox seconds.
    h.advance(&h.exporter, &invoice, 7 * USDC).await?;
    h.repay(&h.buyer2, id, USDC, "before-default").await?;
    let unpaid = 6 * USDC;
    h.advance_past_day(id, 3).await?;
    h.call(&h.keeper, &h.core, "mark_overdue", json!({"id": id}), 0)
        .await?;
    assert_eq!(h.invoice(id).await?["overdue"], true);
    let config = h.view("get_config", json!({})).await?;
    let deadline_day = 3 + config["default_after_days"].as_u64().unwrap();
    h.advance_past_day(id, deadline_day).await?;
    h.call(&h.keeper, &h.core, "mark_default", json!({"id": id}), 0)
        .await?;
    let defaulted = h.pool().await?;
    assert_eq!(h.invoice(id).await?["status"], "Defaulted");
    assert_eq!(amount(&defaulted, "written_off"), unpaid);
    assert_eq!(amount(&defaulted, "outstanding_principal"), 0);
    assert_eq!(amount(&defaulted, "total_assets"), 20 * USDC - unpaid);
    assert!(amount(&defaulted, "share_price_e6") < amount(&initial_pool, "share_price_e6"));
    assert_eq!(h.record(&h.buyer2).await?["frozen"], true);
    let next = h.accepted(&h.exporter, &h.buyer2, USDC, 60).await?;
    let preview = h.view("preview_advance", json!({"id": next["id"]})).await?;
    assert_eq!(preview["eligible"], false);
    assert_eq!(
        preview["reason"],
        format!("buyer frozen after default on {id}")
    );
    let result = h.repay(&h.buyer2, id, 9 * USDC, "after-default").await?;
    assert!(result
        .logs()
        .iter()
        .any(|log| log.contains("\"outcome\":\"after_default\"")));
    let recovered = h.pool().await?;
    assert_eq!(amount(&recovered, "written_off"), 0);
    assert_eq!(amount(&recovered, "idle"), 20_075_000);
    assert!(amount(&recovered, "share_price_e6") > amount(&defaulted, "share_price_e6"));
    assert!(amount(&recovered, "share_price_e6") > amount(&initial_pool, "share_price_e6"));
    assert_eq!(h.invoice(id).await?["status"], "Repaid");
    assert_eq!(h.nft_owner(id).await?, h.exporter.id().as_str());
    let record = h.record(&h.buyer2).await?;
    assert_eq!(record["recovered"], 1);
    assert_eq!(record["score"], -15);
    assert_eq!(record["frozen"], true);
    h.call(
        &h.owner,
        &h.core,
        "unfreeze_buyer",
        json!({"account_id": h.buyer2.id()}),
        1,
    )
    .await?;
    assert_eq!(h.record(&h.buyer2).await?["frozen"], false);
    Ok(())
}

#[tokio::test]
async fn unattributed_and_overpaid() -> Result<()> {
    let h = Harness::new().await?;
    let sender_before = h.balance(&h.buyer).await?;
    let core_before = h.token_balance(&h.usdc, h.core.id().as_str()).await?;
    h.transfer(&h.buyer, USDC, "not-json".into()).await?;
    h.repay(&h.buyer, "TW-UNKNOWN", 2 * USDC, "unknown").await?;
    assert_eq!(h.balance(&h.buyer).await?, sender_before - 3 * USDC);
    assert_eq!(
        h.token_balance(&h.usdc, h.core.id().as_str()).await?,
        core_before + 3 * USDC
    );
    let entries = h.view("list_unattributed", json!({})).await?;
    assert_eq!(entries.as_array().unwrap().len(), 2);
    assert_eq!(entries[0]["msg"], "not-json");
    assert_eq!(amount(&entries[0], "amount"), USDC);
    assert_eq!(amount(&entries[1], "amount"), 2 * USDC);
    for (index, entry) in entries.as_array().unwrap().iter().enumerate() {
        assert_eq!(entry["resolved"], false);
        assert_eq!(entry["sender"], h.buyer.id().as_str());
        h.call(
            &h.owner,
            &h.core,
            "refund_unattributed",
            json!({
                "index": index.to_string(), "to": h.buyer.id(),
            }),
            1,
        )
        .await?;
    }
    assert_eq!(h.balance(&h.buyer).await?, sender_before);
    assert_eq!(
        h.token_balance(&h.usdc, h.core.id().as_str()).await?,
        core_before
    );
    let entries = h.view("list_unattributed", json!({})).await?;
    assert!(entries
        .as_array()
        .unwrap()
        .iter()
        .all(|entry| entry["resolved"] == true));
    let invoice = h.accepted(&h.exporter, &h.buyer, 10 * USDC, 60).await?;
    let id = invoice["id"].as_str().unwrap();
    h.advance(&h.exporter, &invoice, 7 * USDC).await?;
    h.repay(&h.buyer, id, 12 * USDC, "overpaid").await?;
    assert_eq!(h.balance(&h.buyer).await?, sender_before - 12 * USDC);
    assert_eq!(amount(&h.invoice(id).await?["paid"], "overpaid"), 2 * USDC);
    let pool = h.pool().await?;
    assert_eq!(amount(&pool, "total_assets"), 20_150_000);
    assert_eq!(
        h.token_balance(&h.usdc, h.core.id().as_str()).await?,
        22_150_000
    );
    h.call(
        &h.owner,
        &h.core,
        "refund_overpaid",
        json!({
            "id": id, "to": h.buyer.id(), "amount": (2 * USDC).to_string(),
        }),
        1,
    )
    .await?;
    assert_eq!(h.balance(&h.buyer).await?, sender_before - 10 * USDC);
    assert_eq!(amount(&h.invoice(id).await?, "overpaid_refunded"), 2 * USDC);
    assert_eq!(h.pool().await?, pool);
    let duplicate = h
        .transact(
            &h.owner,
            &h.core,
            "refund_overpaid",
            json!({
                "id": id, "to": h.buyer.id(), "amount": "1",
            }),
            1,
        )
        .await?;
    assert_failure(&duplicate, "exceeds overpaid");
    Ok(())
}

#[tokio::test]
async fn lp_allowlist_and_redeem() -> Result<()> {
    let h = Harness::new().await?;
    let bot_before = h.balance(&h.bot).await?;
    let pool_before = h.pool().await?;
    h.transfer(&h.bot, 5 * USDC, json!({"action": "deposit"}).to_string())
        .await?;
    assert_eq!(h.balance(&h.bot).await?, bot_before);
    assert_eq!(h.pool().await?, pool_before);
    assert_eq!(h.token_balance(&h.core, h.bot.id().as_str()).await?, 0);
    let metadata: serde_json::Value = h.core.view("ft_metadata").await?.json()?;
    assert_eq!(metadata["symbol"], "twPOOL");
    assert_eq!(metadata["decimals"], 6);
    assert_eq!(
        h.token_balance(&h.core, h.lp.id().as_str()).await?,
        20 * USDC
    );
    let invoice = h.accepted(&h.exporter, &h.buyer, 10 * USDC, 60).await?;
    h.advance(&h.exporter, &invoice, 7 * USDC).await?;
    let failed = h
        .transact(&h.lp, &h.core, "redeem", json!({"shares": "20000000"}), 1)
        .await?;
    assert_failure(&failed, "liquidity in advances");
    assert_eq!(
        h.token_balance(&h.core, h.lp.id().as_str()).await?,
        20 * USDC
    );
    let before = h.balance(&h.lp).await?;
    h.call(&h.lp, &h.core, "redeem", json!({"shares": "5000000"}), 1)
        .await?;
    assert_eq!(h.balance(&h.lp).await?, before + 5 * USDC);
    assert_eq!(
        h.token_balance(&h.core, h.lp.id().as_str()).await?,
        15 * USDC
    );
    let pool = h.pool().await?;
    assert_eq!(amount(&pool, "total_shares"), 15 * USDC);
    assert_eq!(amount(&pool, "idle"), 8 * USDC);
    assert_eq!(amount(&pool, "outstanding_principal"), 7 * USDC);
    Ok(())
}

#[tokio::test]
async fn advance_revert_when_exporter_unregistered() -> Result<()> {
    let h = Harness::new().await?;
    let exporter2 = h
        .worker
        .root_account()?
        .create_subaccount("exporter2")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let registration: serde_json::Value = h
        .usdc
        .view("storage_balance_of")
        .args_json(json!({"account_id": exporter2.id()}))
        .await?
        .json()?;
    assert!(registration.is_null());
    let invoice = h.accepted(&exporter2, &h.buyer, 10 * USDC, 60).await?;
    let id = invoice["id"].as_str().unwrap();
    let pool = h.pool().await?;
    let record = h.record(&h.buyer).await?;
    // The payout receipt fails, but the final callback succeeds with false.
    let result = h
        .transact(
            &exporter2,
            &h.core,
            "request_advance",
            Harness::advance_args(&invoice, 7 * USDC),
            0,
        )
        .await?;
    assert!(result.is_success(), "callback must succeed: {result:#?}");
    assert!(!result.receipt_failures().is_empty());
    assert!(result
        .logs()
        .iter()
        .any(|log| log.contains("advance_reverted")));
    assert!(!result.json::<bool>()?);
    let reverted = h.invoice(id).await?;
    assert_eq!(reverted["status"], "Accepted");
    assert!(reverted["advance"].is_null());
    assert_eq!(h.nft_owner(id).await?, exporter2.id().as_str());
    assert_eq!(h.pool().await?, pool);
    assert_eq!(h.record(&h.buyer).await?, record);
    assert_eq!(h.balance(&exporter2).await?, 0);
    Ok(())
}

#[tokio::test]
async fn pause() -> Result<()> {
    let h = Harness::new().await?;
    let funded = h.accepted(&h.exporter, &h.buyer, 10 * USDC, 60).await?;
    h.advance(&h.exporter, &funded, 7 * USDC).await?;
    let accepted = h.accepted(&h.exporter, &h.buyer2, USDC, 365).await?;
    let verified = h.create(&h.exporter, &h.buyer2, USDC, 365).await?;
    h.verify(&verified).await?;
    h.call(&h.owner, &h.core, "pause", json!({}), 1).await?;
    let failed_create = h
        .transact(
            &h.exporter,
            &h.core,
            "create_invoice",
            json!({
                "buyer": h.buyer.id(), "buyer_label": "gulf-foods", "invoice_number": "PAUSED",
                "face": "1000000", "tenor_days": 60, "doc_hash": "ab".repeat(32),
            }),
            NearToken::from_near(1).as_yoctonear(),
        )
        .await?;
    assert_failure(&failed_create, "paused");
    let failed_accept = h
        .transact(
            &h.buyer2,
            &h.core,
            "accept_invoice",
            json!({
                "id": verified["id"], "terms_hash": verified["terms_hash"],
            }),
            1,
        )
        .await?;
    assert_failure(&failed_accept, "paused");
    let failed_advance = h
        .transact(
            &h.exporter,
            &h.core,
            "request_advance",
            Harness::advance_args(&accepted, 1),
            0,
        )
        .await?;
    assert_failure(&failed_advance, "paused");
    let balance = h.balance(&h.lp).await?;
    let pool = h.pool().await?;
    h.transfer(&h.lp, USDC, json!({"action": "deposit"}).to_string())
        .await?;
    assert_eq!(h.balance(&h.lp).await?, balance);
    assert_eq!(h.pool().await?, pool);
    let id = funded["id"].as_str().unwrap();
    h.repay(&h.buyer, id, USDC, "paused-repayment").await?;
    assert_eq!(amount(&h.invoice(id).await?["paid"], "total"), USDC);
    h.advance_past_day(id, 60).await?;
    h.call(&h.keeper, &h.core, "mark_overdue", json!({"id": id}), 0)
        .await?;
    assert_eq!(h.invoice(id).await?["overdue"], true);
    h.advance_past_day(id, 90).await?;
    h.call(&h.keeper, &h.core, "mark_default", json!({"id": id}), 0)
        .await?;
    assert_eq!(h.invoice(id).await?["status"], "Defaulted");
    h.repay(&h.buyer, id, 9 * USDC, "paused-recovery").await?;
    assert_eq!(h.invoice(id).await?["status"], "Repaid");
    assert_eq!(h.view("get_config", json!({})).await?["paused"], true);
    Ok(())
}

#[tokio::test]
async fn approver_bot() -> Result<()> {
    let h = Harness::new().await?;
    let invoice = h.accepted(&h.exporter, &h.buyer, 10 * USDC, 60).await?;
    h.call(
        &h.exporter,
        &h.core,
        "set_approver",
        json!({"approver": h.bot.id()}),
        1,
    )
    .await?;
    assert_eq!(
        h.view("get_approver", json!({"exporter": h.exporter.id()}))
            .await?,
        h.bot.id().as_str()
    );
    let rejected = h
        .transact(
            &h.keeper,
            &h.core,
            "request_advance",
            Harness::advance_args(&invoice, 7 * USDC),
            0,
        )
        .await?;
    assert_failure(&rejected, "exporter or approver only");
    let exporter_balance = h.balance(&h.exporter).await?;
    let bot_balance = h.balance(&h.bot).await?;
    h.advance(&h.bot, &invoice, 7 * USDC).await?;
    assert_eq!(h.balance(&h.exporter).await?, exporter_balance + 7 * USDC);
    assert_eq!(h.balance(&h.bot).await?, bot_balance);
    assert_eq!(
        h.invoice(invoice["id"].as_str().unwrap()).await?["status"],
        "Funded"
    );
    Ok(())
}

#[tokio::test]
async fn guided_cancel_override_and_reasons() -> Result<()> {
    let h = Harness::new().await?;
    let created = h.create(&h.exporter, &h.buyer, USDC, 365).await?;
    let id = created["id"].as_str().unwrap();
    assert_eq!(
        h.view("preview_advance", json!({"id": id})).await?["reason"],
        "invoice must be Accepted"
    );
    h.call(&h.exporter, &h.core, "cancel_invoice", json!({"id": id}), 0)
        .await?;
    assert_eq!(h.invoice(id).await?["status"], "Cancelled");
    assert!(h
        .view("nft_token", json!({"token_id": id}))
        .await?
        .is_null());

    let invoice = h.accepted(&h.exporter, &h.buyer, 10 * USDC, 365).await?;
    let id = invoice["id"].as_str().unwrap();
    h.call(
        &h.owner,
        &h.core,
        "set_buyer_limit_override",
        json!({"account_id": h.buyer.id(), "limit": "0"}),
        1,
    )
    .await?;
    assert_eq!(
        h.view("preview_advance", json!({"id": id})).await?["reason"],
        "buyer exposure limit reached: $0.00 open of $0.00"
    );
    h.call(
        &h.owner,
        &h.core,
        "set_buyer_limit_override",
        json!({"account_id": h.buyer.id(), "limit": "50000000"}),
        1,
    )
    .await?;
    assert_eq!(
        h.view("preview_advance", json!({"id": id})).await?["eligible"],
        true
    );
    assert_eq!(h.record(&h.buyer).await?["buyer_limit"], "50000000");
    h.call(&h.owner, &h.core, "pause", json!({}), 1).await?;
    assert_eq!(
        h.view("preview_advance", json!({"id": id})).await?["reason"],
        "contract paused"
    );
    let before = h.record(&h.buyer).await?;
    let result = h
        .call(&h.owner, &h.core, "cancel_invoice", json!({"id": id}), 1)
        .await?;
    assert!(result.logs().iter().any(|log| log.contains("nft_burn")));
    assert_eq!(h.invoice(id).await?["status"], "Cancelled");
    assert!(h
        .view("nft_token", json!({"token_id": id}))
        .await?
        .is_null());
    assert_eq!(h.view("nft_total_supply", json!({})).await?, "0");
    assert_eq!(h.record(&h.buyer).await?, before);
    let result = h
        .transact(&h.keeper, &h.core, "mark_default", json!({"id": id}), 0)
        .await?;
    assert_failure(&result, "invalid status");
    h.call(
        &h.owner,
        &h.core,
        "set_buyer_limit_override",
        json!({"account_id": h.buyer.id(), "limit": null}),
        1,
    )
    .await?;
    assert_eq!(h.record(&h.buyer).await?["buyer_limit"], "10000000");
    Ok(())
}
