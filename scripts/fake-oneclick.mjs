// Local simulation only: this service never moves cross-chain funds.
import http from "node:http";
import { pathToFileURL } from "node:url";
export async function startFakeOneClick({ port = Number(process.env.FAKE_ONECLICK_PORT || 4444), polls = Number(process.env.FAKE_ONECLICK_POLLS || 3), force = process.env.FAKE_ONECLICK_FORCE, callbackUrl = process.env.FAKE_ONECLICK_CALLBACK_URL } = {}) {
  if (callbackUrl && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(callbackUrl)) throw new Error("Callback must be localhost");
  const intents = new Map(); let sequence = 0;
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url, "http://localhost"), parts = [];
      for await (const part of req) { parts.push(part); if (parts.reduce((sum, b) => sum + b.length, 0) > 65536) throw new Error("Body too large"); }
      const body = parts.length ? JSON.parse(Buffer.concat(parts).toString()) : {};
      if (url.pathname === "/v0/tokens") return send(200, [{ assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", blockchain: "base", symbol: "USDC", decimals: 6, price: 1, priceUpdatedAt: new Date().toISOString() }]);
      if (url.pathname === "/v0/quote" && req.method === "POST") {
        const address = `fake-deposit-${++sequence}`;
        const quote = { correlationId: address, timestamp: new Date().toISOString(), signature: "simulated-not-signed", quoteRequest: body, quote: { amountIn: body.amount, amountInFormatted: String(Number(body.amount) / 1e6), minAmountIn: body.amount, amountOut: body.amount, amountOutFormatted: String(Number(body.amount) / 1e6), amountInUsd: "0", amountOutUsd: "0", minAmountOut: body.amount, timeEstimate: 1, deadline: body.deadline, ...(body.dry ? {} : { depositAddress: address }) } };
        intents.set(address, { quote, count: 0, delivered: false }); return send(200, quote);
      }
      if (url.pathname === "/v0/status" || url.pathname === "/v0/deposit/submit") {
        const intent = intents.get(url.searchParams.get("depositAddress") || body.depositAddress);
        if (!intent) return send(404, { message: "Fake deposit not found" });
        const forced = url.searchParams.get("force") || force;
        const status = ++intent.count < polls ? (intent.count === 1 ? "PENDING_DEPOSIT" : "PROCESSING") : (["REFUNDED", "INCOMPLETE_DEPOSIT", "FAILED"].includes(forced) ? forced : "SUCCESS");
        if (status === "SUCCESS" && !intent.delivered && callbackUrl && !intent.quote.quoteRequest.dry && !intent.quote.quoteRequest.customRecipientMsg) {
          const response = await fetch(callbackUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ simulated: true, recipient: intent.quote.quoteRequest.recipient, amountOut: intent.quote.quote.amountOut, depositAddress: intent.quote.quote.depositAddress }) });
          if (!response.ok) throw new Error("Fake delivery callback failed");
          intent.delivered = true;
        }
        return send(200, { simulated: true, correlationId: intent.quote.correlationId, quoteResponse: intent.quote, status, updatedAt: new Date().toISOString(), swapDetails: { intentHashes: [], nearTxHashes: [], originChainTxHashes: [], destinationChainTxHashes: [] } });
      }
      send(404, { message: "Fake route not found" });
    } catch { send(400, { message: "Invalid fake request" }); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fake = await startFakeOneClick(); console.log(`Simulated 1Click (local): ${fake.baseUrl}; no real cross-chain funds moved`);
}
