#![allow(unused_must_use, dead_code)]
//! Shared by the sandbox tests and local demo; never connects to a public RPC.
#![allow(dead_code)]

use anyhow::{bail, ensure, Context, Result};
use near_workspaces::{
    network::Sandbox, result::ExecutionFinalResult, types::NearToken, Account, Contract, Worker,
};
use serde_json::{json, Value};
use std::path::PathBuf;
use tradewind::config::Config;

pub const USDC: u128 = 1_000_000;

pub fn amount(value: &Value, field: &str) -> u128 {
    value[field]
        .as_str()
        .expect("U128 JSON string")
        .parse()
        .unwrap()
}

pub fn wasm(crate_name: &str) -> Result<Vec<u8>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let directory = crate_name.replace('_', "-");
    let mut targets = vec![
        root.join("target"),
        root.join("contracts").join(directory).join("target"),
    ];
    if let Some(target) = std::env::var_os("CARGO_TARGET_DIR") {
        let target = PathBuf::from(target);
        targets.insert(
            0,
            if target.is_absolute() {
                target
            } else {
                root.join(target)
            },
        );
    }
    let mut tried = Vec::new();
    for target in targets {
        for relative in [
            format!("near/{crate_name}.wasm"),
            format!("near/{crate_name}/{crate_name}.wasm"),
        ] {
            let path = target.join(relative);
            match std::fs::read(&path) {
                Ok(bytes) => return Ok(bytes),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    tried.push(path.display().to_string());
                }
                Err(error) => {
                    return Err(error).with_context(|| format!("reading {}", path.display()));
                }
            }
        }
    }
    bail!(
        "Missing {crate_name} wasm. Run `make build` from the repository root first. Tried:\n{}",
        tried.join("\n")
    )
}

pub struct Harness {
    pub worker: Worker<Sandbox>,
    pub core: Contract,
    pub usdc: Contract,
    pub owner: Account,
    pub treasury: Account,
    pub attester: Account,
    pub keeper: Account,
    pub lp: Account,
    pub exporter: Account,
    pub buyer: Account,
    pub buyer2: Account,
    pub bot: Account,
}

impl Harness {
    pub async fn new() -> Result<Self> {
        // Fail before starting sandbox (or downloading it) if artifacts are missing.
        let core_wasm = wasm("tradewind")?;
        let usdc_wasm = wasm("mock_usdc")?;
        let worker = near_workspaces::sandbox().await?;
        let root = worker.root_account()?;
        let mut accounts = Vec::new();
        for name in [
            "owner",
            "treasury",
            "attester",
            "keeper",
            "lp",
            "sample-cashew",
            "gulf-foods",
            "northgate",
            "bot",
        ] {
            accounts.push(
                root.create_subaccount(name)
                    .initial_balance(NearToken::from_near(30))
                    .transact()
                    .await?
                    .into_result()?,
            );
        }
        let mut accounts = accounts.into_iter();
        let owner = accounts.next().unwrap();
        let treasury = accounts.next().unwrap();
        let attester = accounts.next().unwrap();
        let keeper = accounts.next().unwrap();
        let lp = accounts.next().unwrap();
        let exporter = accounts.next().unwrap();
        let buyer = accounts.next().unwrap();
        let buyer2 = accounts.next().unwrap();
        let bot = accounts.next().unwrap();
        let usdc = worker.dev_deploy(&usdc_wasm).await?;
        let core = worker.dev_deploy(&core_wasm).await?;
        let h = Self {
            worker,
            core,
            usdc,
            owner,
            treasury,
            attester,
            keeper,
            lp,
            exporter,
            buyer,
            buyer2,
            bot,
        };
        h.call(&h.owner, &h.usdc, "new", json!({}), 0).await?;
        let mut config = Config::demo_default();
        config.seconds_per_day = 1;
        h.call(
            &h.owner,
            &h.core,
            "new",
            json!({
                "owner": h.owner.id(),
                "treasury": h.treasury.id(),
                "usdc": h.usdc.id(),
                "attester": h.attester.id(),
                "keeper": h.keeper.id(),
                "config": config,
            }),
            0,
        )
        .await?;
        for account in [
            h.core.id(),
            h.exporter.id(),
            h.treasury.id(),
            h.lp.id(),
            h.buyer.id(),
            h.buyer2.id(),
            h.bot.id(),
        ] {
            h.call(
                &h.owner,
                &h.usdc,
                "storage_deposit",
                json!({"account_id": account, "registration_only": true}),
                NearToken::from_millinear(10).as_yoctonear(),
            )
            .await?;
        }
        for account in [&h.lp, &h.buyer, &h.buyer2, &h.bot] {
            h.call(
                &h.owner,
                &h.usdc,
                "mint",
                json!({"account_id": account.id(), "amount": "100000000"}),
                0,
            )
            .await?;
        }
        h.call(
            &h.owner,
            &h.core,
            "lp_allow",
            json!({"account_id": h.lp.id(), "allowed": true}),
            1,
        )
        .await?;
        h.transfer(&h.lp, 20 * USDC, json!({"action": "deposit"}).to_string())
            .await?;
        ensure!(
            amount(&h.pool().await?, "idle") == 20 * USDC,
            "initial deposit failed"
        );
        Ok(h)
    }

    /// Raw result for expected failures, including handled failed receipts.
    pub async fn transact(
        &self,
        caller: &Account,
        contract: &Contract,
        method: &str,
        args: Value,
        deposit: u128,
    ) -> Result<ExecutionFinalResult> {
        Ok(caller
            .call(contract.id(), method)
            .args_json(args)
            .deposit(NearToken::from_yoctonear(deposit))
            .max_gas()
            .transact()
            .await?)
    }

    pub async fn call(
        &self,
        caller: &Account,
        contract: &Contract,
        method: &str,
        args: Value,
        deposit: u128,
    ) -> Result<ExecutionFinalResult> {
        let result = self
            .transact(caller, contract, method, args, deposit)
            .await?;
        ensure!(result.is_success(), "{method} failed: {result:#?}");
        ensure!(
            result.receipt_failures().is_empty(),
            "{method} receipt failed: {result:#?}"
        );
        Ok(result)
    }

    pub async fn view(&self, method: &str, args: Value) -> Result<Value> {
        Ok(self.core.view(method).args_json(args).await?.json()?)
    }

    pub async fn pool(&self) -> Result<Value> {
        self.view("get_pool", json!({})).await
    }

    pub async fn invoice(&self, id: &str) -> Result<Value> {
        self.view("get_invoice", json!({"id": id})).await
    }

    pub async fn record(&self, buyer: &Account) -> Result<Value> {
        self.view("get_buyer_record", json!({"account_id": buyer.id()}))
            .await
    }

    pub async fn balance(&self, account: &Account) -> Result<u128> {
        self.token_balance(&self.usdc, account.id().as_str()).await
    }

    pub async fn token_balance(&self, token: &Contract, account: &str) -> Result<u128> {
        let value: String = token
            .view("ft_balance_of")
            .args_json(json!({"account_id": account}))
            .await?
            .json()?;
        Ok(value.parse()?)
    }

    pub async fn nft_owner(&self, id: &str) -> Result<String> {
        let token = self.view("nft_token", json!({"token_id": id})).await?;
        Ok(token["owner_id"]
            .as_str()
            .context("missing NFT")?
            .to_string())
    }

    pub async fn create(
        &self,
        exporter: &Account,
        buyer: &Account,
        face: u128,
        tenor: u32,
    ) -> Result<Value> {
        Ok(self
            .call(
                exporter,
                &self.core,
                "create_invoice",
                json!({
                    "buyer": buyer.id(),
                    "buyer_label": buyer.id().as_str(),
                    "invoice_number": "LOCAL-INVOICE",
                    "face": face.to_string(),
                    "tenor_days": tenor,
                    "doc_hash": "ab".repeat(32),
                    "terms_hash": null,
                }),
                NearToken::from_near(1).as_yoctonear(),
            )
            .await?
            .json()?)
    }

    pub async fn verify(&self, invoice: &Value) -> Result<()> {
        self.call(
            &self.attester,
            &self.core,
            "record_verification",
            json!({
                "id": invoice["id"],
                "v": {
                    "verdict": "pass",
                    "model_id": "local-demo-mock",
                    "request_hash": "cd".repeat(32),
                    "response_hash": "ef".repeat(32),
                    "signature": "MOCK-NOT-A-TEE-SIGNATURE",
                    "signing_address": "local-mock",
                    "signing_algo": "mock",
                    "chat_id": "local-demo",
                },
            }),
            0,
        )
        .await?;
        Ok(())
    }

    pub async fn accept(&self, buyer: &Account, invoice: &Value) -> Result<()> {
        self.call(
            buyer,
            &self.core,
            "accept_invoice",
            json!({"id": invoice["id"], "terms_hash": invoice["terms_hash"]}),
            1,
        )
        .await?;
        Ok(())
    }

    pub async fn accepted(
        &self,
        exporter: &Account,
        buyer: &Account,
        face: u128,
        tenor: u32,
    ) -> Result<Value> {
        let invoice = self.create(exporter, buyer, face, tenor).await?;
        self.verify(&invoice).await?;
        self.accept(buyer, &invoice).await?;
        Ok(invoice)
    }

    pub fn advance_args(invoice: &Value, min: u128) -> Value {
        json!({
            "id": invoice["id"], "expected_terms_hash": invoice["terms_hash"],
            "min_advance": min.to_string(),
        })
    }

    pub async fn advance(&self, caller: &Account, invoice: &Value, min: u128) -> Result<()> {
        let result = self
            .call(
                caller,
                &self.core,
                "request_advance",
                Self::advance_args(invoice, min),
                0,
            )
            .await?;
        ensure!(result.json::<bool>()?, "advance callback reverted");
        Ok(())
    }

    pub async fn transfer(
        &self,
        sender: &Account,
        value: u128,
        msg: String,
    ) -> Result<ExecutionFinalResult> {
        // max_gas = 300 TGas: repayments can schedule two transfers + callbacks.
        self.call(
            sender,
            &self.usdc,
            "ft_transfer_call",
            json!({
                "receiver_id": self.core.id(),
                "amount": value.to_string(),
                "memo": null,
                "msg": msg,
            }),
            1,
        )
        .await
    }

    pub async fn repay(
        &self,
        sender: &Account,
        id: &str,
        value: u128,
        reference: &str,
    ) -> Result<ExecutionFinalResult> {
        self.transfer(
            sender,
            value,
            json!({"action": "repay", "invoice_id": id, "payment_ref": reference}).to_string(),
        )
        .await
    }

    /// Four real on-time invoices, not privileged state injection: score 12/rate 82%.
    pub async fn seed_record(&self) -> Result<()> {
        for n in 0..4 {
            let invoice = self
                .accepted(&self.exporter, &self.buyer, USDC, 365)
                .await?;
            self.repay(
                &self.buyer,
                invoice["id"].as_str().unwrap(),
                USDC,
                &format!("seed-{n}"),
            )
            .await?;
        }
        ensure!(
            self.record(&self.buyer).await?["score"] == 12,
            "seed repayments were not on time"
        );
        Ok(())
    }

    /// Sandbox blocks are approximately one second; use 2x the requested days
    /// plus 10 blocks, then explicitly verify the contract clock crossed it.
    /// Fast-forwards until the invoice's contract day is past `day`.
    /// Sandbox block time varies by machine, so loop instead of assuming 1 s/block.
    pub async fn advance_past_day(&self, id: &str, day: u64) -> Result<()> {
        let mut elapsed = 0u64;
        for _ in 0..40 {
            let remaining = day.saturating_sub(elapsed);
            self.worker
                .fast_forward(remaining.saturating_mul(2).saturating_add(10))
                .await?;
            let v = self.view("now_contract_day", json!({"id": id})).await?;
            elapsed = v.as_str().context("missing contract day")?.parse()?;
            if elapsed > day {
                return Ok(());
            }
        }
        anyhow::bail!("sandbox clock advanced only {elapsed} days; expected > {day}")
    }
}

pub fn assert_failure(result: &ExecutionFinalResult, message: &str) {
    assert!(result.is_failure(), "expected failure: {result:#?}");
    assert!(
        format!("{result:#?}").contains(message),
        "missing {message:?}: {result:#?}"
    );
}
