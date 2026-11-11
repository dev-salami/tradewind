import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Account } from "near-api-js";
import { z } from "zod";
import { assertSameOrigin } from "../auth/session";
import { store } from "../db";
import { ApiError, jsonError } from "../errors";
import { recordVerification } from "../near/attester";
import { formSchema } from "../nearai/prompt";
import { runVerification } from "../nearai/verify-flow";
import { tokenBucket } from "../rate-limit";
import { guidedConfig } from "./config";
import { samplePdf } from "./sample-pdf";
import { withAccountLock, withGuidedSigner } from "./signer";

const allow = tokenBucket(20, 60_000);
const units = z.string().regex(/^[1-9]\d{0,38}$/).refine(v => BigInt(v) <= (1n << 128n) - 1n);
const invoiceBody = z.object({ face: units.default("10000000"), tenor_days: z.number().int().min(1).max(365).default(60) }).strict();
const idBody = z.object({ invoice_id: z.string().regex(/^TW-\d{4,20}$/) }).strict();
const payBody = idBody.extend({ amount: units.optional() });
type Action = "invoice" | "accept" | "advance" | "pay" | "status";
interface Invoice { id: string; exporter: string; buyer: string; terms_hash: string; face: string; paid: { total: string; overpaid: string }; status: string }
const GAS = 30_000_000_000_000n;
const STORAGE = 100_000_000_000_000_000_000_000n; // 0.1 NEAR; contract refunds excess.
const MINT_STORAGE = 1_250_000_000_000_000_000_000n; // NEP-145 minimum for mock USDC.
const links = (hashes: string[]) => hashes.map(hash => `https://testnet.nearblocks.io/txns/${encodeURIComponent(hash)}`);
function audit(action: string, id: string, detail: object) { store().audit(action, id, JSON.stringify({ ...detail, actor: "guided" })); }
async function invoiceFor(account: Account, id: string): Promise<Invoice> {
  const e = guidedConfig();
  const invoice = await account.viewFunction({ contractId: e.CORE_CONTRACT_ID, methodName: "get_invoice", args: { id } }) as Invoice | null;
  if (!invoice) throw new ApiError("Invoice not found", 404);
  if (invoice.exporter !== e.exporter || invoice.buyer !== e.buyer) throw new ApiError("Invoice is not for the guided accounts", 403);
  return invoice;
}

export async function guidedPost(action: Action, request: Request): Promise<Response> {
  const tx_hashes: string[] = [];
  let invoice_id = "";
  try {
    const e = guidedConfig();
    assertSameOrigin(request);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    if (!allow(ip)) throw new ApiError("Too many guided requests", 429);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new ApiError("JSON required", 415);
    let body: unknown;
    try { body = await request.json(); } catch { throw new ApiError("Invalid JSON"); }
    const parsed = (action === "invoice" ? invoiceBody : action === "pay" ? payBody : action === "status" ? z.object({}).strict() : idBody).safeParse(body);
    if (!parsed.success) throw new ApiError("Invalid guided payload");
    const input = parsed.data;
    async function call(account: Account, contractId: string, methodName: string, args: object, attachedDeposit = 0n, gas = GAS) {
      guidedConfig();
      const outcome = await account.functionCall({ contractId, methodName, args, gas, attachedDeposit });
      const hash = outcome.transaction.hash;
      tx_hashes.push(hash);
      audit(methodName, invoice_id, { tx_hash: hash, tx_link: links([hash])[0] });
      return outcome;
    }
    if (action === "status") {
      audit("guided_status", "", {});
      return Response.json({ available: true, network: e.NEAR_NETWORK, exporter: e.exporter, buyer: e.buyer, tx_hashes, tx_links: [] }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "invoice") {
      // Parsed above; separate parsing preserves the discriminated payload types.
      const { face, tenor_days } = invoiceBody.parse(input);
      const bytes = await samplePdf(face, tenor_days);
      try {
        const doc_hash = createHash("sha256").update(bytes).digest("hex");
        await withGuidedSigner("exporter", async account => {
          const outcome = await call(account, e.CORE_CONTRACT_ID, "create_invoice", { buyer: e.buyer, buyer_label: "Gulf Foods Trading (sample)", invoice_number: "TW-0042", face, tenor_days, doc_hash, terms_hash: null }, STORAGE);
          if (typeof outcome.status !== "object" || !("SuccessValue" in outcome.status)) throw new ApiError("Invoice creation failed", 502);
          const created = JSON.parse(Buffer.from(outcome.status.SuccessValue, "base64").toString("utf8")) as Invoice;
          invoice_id = idBody.parse({ invoice_id: created.id }).invoice_id;
          audit("guided_invoice", invoice_id, { doc_hash, tx_hashes });
        });
        const result = await runVerification({ invoiceId: invoice_id, pdfBytes: bytes, formFields: formSchema.parse({ exporter: e.exporter, buyer: e.buyer, buyer_label: "Gulf Foods Trading (sample)", invoice_number: "TW-0042", face, tenor_days }) });
        store().putVerification(invoice_id, result, null);
        if (!result.verified_ok && !result.mock) throw new ApiError("Unverified response cannot be attested", 422);
        const hash = await withAccountLock(e.ATTESTER_ACCOUNT_ID, () => { guidedConfig(); return recordVerification(invoice_id, result); });
        tx_hashes.push(hash);
        store().putVerification(invoice_id, result, hash);
        audit("record_verification", invoice_id, { tx_hash: hash, tx_link: links([hash])[0], verdict: result.verdict, mock: result.mock });
        return Response.json({ invoice_id, tx_hashes, tx_links: links(tx_hashes), verdict: result.verdict, mock: result.mock }, { headers: { "Cache-Control": "no-store" } });
      } finally { bytes.fill(0); }
    }
    invoice_id = idBody.parse({ invoice_id: "invoice_id" in input ? input.invoice_id : undefined }).invoice_id;
    await withGuidedSigner(action === "advance" ? "exporter" : "buyer", async account => {
      const invoice = await invoiceFor(account, invoice_id);
      if (action === "accept") {
        if (invoice.status !== "Verified") throw new ApiError("Invoice must be Verified", 409);
        await call(account, e.CORE_CONTRACT_ID, "accept_invoice", { id: invoice_id, terms_hash: invoice.terms_hash }, 1n);
      } else if (action === "advance") {
        const preview = await account.viewFunction({ contractId: e.CORE_CONTRACT_ID, methodName: "preview_advance", args: { id: invoice_id } }) as { eligible: boolean; advance: string };
        if (!preview.eligible) throw new ApiError("Invoice is not eligible for advance", 409);
        await call(account, e.CORE_CONTRACT_ID, "request_advance", { id: invoice_id, expected_terms_hash: invoice.terms_hash, min_advance: units.parse(preview.advance) }, 0n, 100_000_000_000_000n);
      } else {
        if (!["Accepted", "Funded", "PartiallyPaid", "Defaulted"].includes(invoice.status)) throw new ApiError("Invoice cannot receive payment", 409);
        const outstanding = BigInt(invoice.face) - (BigInt(invoice.paid.total) - BigInt(invoice.paid.overpaid));
        const { amount: supplied } = payBody.parse(input);
        const amount = supplied ? BigInt(supplied) : outstanding;
        const config = await account.viewFunction({ contractId: e.CORE_CONTRACT_ID, methodName: "get_config", args: {} }) as { min_payment: string };
        if (amount <= 0n || amount > outstanding || (amount < BigInt(config.min_payment) && amount !== outstanding)) throw new ApiError("Amount must be at least min_payment or full outstanding");
        const balance = BigInt(await account.viewFunction({ contractId: e.USDC_CONTRACT_ID, methodName: "ft_balance_of", args: { account_id: e.buyer } }) as string);
        let shortage = amount > balance ? amount - balance : 0n;
        // The mock faucet caps each mint at 1,000 tUSDC.
        while (shortage > 0n) {
          const mint = shortage > 1_000_000_000n ? 1_000_000_000n : shortage;
          await call(account, e.USDC_CONTRACT_ID, "mint", { account_id: e.buyer, amount: mint.toString() }, MINT_STORAGE);
          shortage -= mint;
        }
        await call(account, e.USDC_CONTRACT_ID, "ft_transfer_call", { receiver_id: e.CORE_CONTRACT_ID, amount: amount.toString(), msg: JSON.stringify({ action: "repay", invoice_id, payment_ref: `guided:${randomUUID()}` }) }, 1n, 300_000_000_000_000n);
      }
    });
    return Response.json({ invoice_id, tx_hashes, tx_links: links(tx_hashes) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Include completed transactions if a later step failed; never expose keys or RPC errors.
    const response = jsonError(error);
    return Response.json({ ...await response.json(), invoice_id: invoice_id || undefined, tx_hashes, tx_links: links(tx_hashes) }, { status: response.status, headers: { "Cache-Control": "no-store" } });
  }
}
