import { describe, expect, it } from "vitest";
import { OneClickClient, buildRepayQuote, ORIGIN_ASSETS } from "../src/index";
// @ts-expect-error Dependency-free JavaScript simulator
import { startFakeOneClick } from "../../../scripts/fake-oneclick.mjs";
describe("local 1Click transport simulator", () => {
  it.each([undefined, "REFUNDED", "INCOMPLETE_DEPOSIT", "FAILED"])("runs scripted status flow (%s)", async force => {
    const fake = await startFakeOneClick({ port: 0, polls: 3, force });
    try {
      const client = new OneClickClient(fake.baseUrl);
      expect((await client.getTokens())[0].symbol).toBe("USDC");
      const quote = await client.quote(buildRepayQuote({ invoiceId: "invoice", outstandingUnits: "1000000", amountUnits: "1000000", originAsset: ORIGIN_ASSETS.Base.assetId, refundTo: `0x${"1".repeat(40)}`, recipient: "core.test.near", paymentRef: "pid", path: "B", relayer: "relayer.test.near", dry: false }));
      expect(quote.quote.depositAddress).toMatch(/^fake-deposit-/);
      expect((await client.status(quote.quote.depositAddress!)).status).toBe("PENDING_DEPOSIT");
      expect((await client.submitDeposit({ depositAddress: quote.quote.depositAddress!, txHash: "simulated-tx" })).status).toBe("PROCESSING");
      const status = await client.status(quote.quote.depositAddress!);
      expect(status.status).toBe(force ?? "SUCCESS"); expect(status.quoteResponse.quote.amountOut).toBe("1000000"); expect(status.swapDetails.nearTxHashes).toEqual([]);
      expect((await client.status(quote.quote.depositAddress!)).status).toBe(force ?? "SUCCESS");
    } finally { await fake.close(); }
  });
});
