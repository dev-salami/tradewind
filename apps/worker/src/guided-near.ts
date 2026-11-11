import { Account, KeyPair, keyStores, connect } from "near-api-js";
import type { Invoice } from "@tradewind/core";
import { decryptGuidedKey, type GuidedSession } from "../../web/src/server/guided/session-store";

// Deliberately independent of Next's server-only modules.
export async function guidedCleanupCall(action: "cancel" | "repay", invoice: Invoice, session: GuidedSession): Promise<string> {
  if (process.env.NEAR_NETWORK === "mainnet" || !["testnet", "sandbox"].includes(process.env.NEAR_NETWORK || "") || process.env.GUIDED_ENABLED !== "1") throw new Error("Guided cleanup disabled");
  const networkId = process.env.NEAR_NETWORK!, nodeUrl = process.env.NEAR_RPC_URL;
  const core = process.env.CORE_CONTRACT_ID, usdc = process.env.USDC_CONTRACT_ID;
  const accountId = action === "cancel" ? process.env.GUIDED_EXPORTER_ACCOUNT_ID : session.buyer_account;
  const key = action === "cancel" ? process.env.GUIDED_EXPORTER_PRIVATE_KEY : decryptGuidedKey(session.encrypted_key);
  if (!nodeUrl || !core || !usdc || !accountId || !key) throw new Error("Guided cleanup not configured");
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(networkId, accountId, KeyPair.fromString(key as `ed25519:${string}`));
  const near = await connect({ networkId, nodeUrl, keyStore });
  let account = new Account(near.connection, accountId);
  const current = await account.viewFunction({ contractId: core, methodName: "get_invoice", args: { id: invoice.id } }) as Invoice | null;
  if (!current || current.buyer !== session.buyer_account || current.exporter !== process.env.GUIDED_EXPORTER_ACCOUNT_ID) throw new Error("Guided invoice mismatch");
  async function call(contractId: string, methodName: string, args: Record<string, unknown>, attachedDeposit = 0n, gas = 100_000_000_000_000n) {
    const result = await account.functionCall({ contractId, methodName, args, attachedDeposit, gas });
    if (typeof result.status === "object" && "Failure" in result.status) throw new Error(`Guided transaction failed: ${JSON.stringify(result.status.Failure)}`);
    return result.transaction.hash;
  }
  if (action === "cancel") {
    if (current.advance || !["Created", "Verified", "Accepted"].includes(current.status)) throw new Error("Guided invoice changed");
    const target = core, id = current.id;
    // Current contracts are nonpayable; incoming versions may require one yocto.
    // Retry only explicit deposit/auth rejections, never ambiguous RPC failures.
    async function cancel() {
      try { return await call(target, "cancel_invoice", { id }); }
      catch (error) {
        if (!/one.?yocto|1 yocto|exactly (one|1).*yocto/i.test(String(error))) throw error;
        return call(target, "cancel_invoice", { id }, 1n);
      }
    }
    try { return await cancel(); }
    catch (error) {
      // Optional compatibility with versions restricting Accepted cancellation
      // to the owner. Exporter remains the default; owner keys are not required.
      const owner = process.env.OWNER_ACCOUNT_ID, ownerKey = process.env.OWNER_PRIVATE_KEY;
      if (current.status !== "Accepted" || !/owner only|owner.*(required|cancel)|unauthorized/i.test(String(error)) || !owner || !ownerKey) throw error;
      await keyStore.setKey(networkId, owner, KeyPair.fromString(ownerKey as `ed25519:${string}`));
      account = new Account(near.connection, owner);
      return cancel();
    }
  }
  if (!current.advance || !["Funded", "PartiallyPaid", "Defaulted"].includes(current.status)) throw new Error("Guided invoice changed");
  const outstanding = BigInt(current.face) - BigInt(current.paid.total) + BigInt(current.paid.overpaid);
  if (outstanding <= 0n) throw new Error("Nothing outstanding");
  const balance = BigInt(await account.viewFunction({ contractId: usdc, methodName: "ft_balance_of", args: { account_id: accountId } }) as string);
  let shortage = outstanding > balance ? outstanding - balance : 0n;
  while (shortage > 0n) {
    const amount = shortage > 1_000_000_000n ? 1_000_000_000n : shortage;
    await call(usdc, "mint", { account_id: accountId, amount: amount.toString() }, 1_250_000_000_000_000_000_000n, 30_000_000_000_000n);
    shortage -= amount;
  }
  const hash = await call(usdc, "ft_transfer_call", { receiver_id: core, amount: outstanding.toString(), msg: JSON.stringify({ action: "repay", invoice_id: current.id, payment_ref: `guided-cleanup:${current.id}:${current.paid.total}` }) }, 1n, 300_000_000_000_000n);
  const after = await account.viewFunction({ contractId: core, methodName: "get_invoice", args: { id: current.id } }) as Invoice | null;
  if (after?.status !== "Repaid") throw new Error("Guided repayment not confirmed");
  return hash;
}
