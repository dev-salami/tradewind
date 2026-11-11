import http from "node:http";
import { pathToFileURL } from "node:url";

/** Local Bot API fixture. pushUpdate posts to a configured localhost webhook. */
export async function startFakeTelegram({ port = 0 } = {}) {
  const calls = [];
  let messageId = 0;
  let webhook;
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      const requestUrl = new URL(req.url, "http://localhost");
      const match = /^\/bot[^/]+\/([a-zA-Z]+)$/.exec(requestUrl.pathname);
      if (!match) return reply(404, { ok: false, description: "Unknown endpoint" });
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      const parsed = req.headers["content-type"]?.includes("application/json")
        ? JSON.parse(body || "{}") : Object.fromEntries(new URLSearchParams(body));
      const params = { ...Object.fromEntries(requestUrl.searchParams), ...parsed };
      if (typeof params.reply_markup === "string") params.reply_markup = JSON.parse(params.reply_markup);
      const method = match[1];
      calls.push({ method, params });
      let result = true;
      switch (method) {
        case "getMe": result = { id: 0, is_bot: true, first_name: "Fixture bot", username: "fixture_bot" }; break;
        case "sendMessage":
        case "editMessageText":
        case "editMessageReplyMarkup":
          result = { message_id: Number(params.message_id) || ++messageId, date: Math.floor(Date.now() / 1000), chat: { id: Number(params.chat_id), type: "private" }, text: params.text, reply_markup: params.reply_markup }; break;
        case "answerCallbackQuery": break;
        case "setWebhook":
          if (params.url) assertLocal(params.url);
          webhook = params; break;
        case "deleteWebhook": webhook = undefined; break;
        default: return reply(404, { ok: false, description: "Unsupported method" });
      }
      reply(200, { ok: true, result });
    } catch (error) { reply(400, { ok: false, description: error.message }); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return {
    url: `http://127.0.0.1:${server.address().port}`, calls,
    async pushUpdate(update, target = webhook?.url, secret = webhook?.secret_token) {
      if (!target) throw new Error("Set a localhost webhook first");
      assertLocal(target);
      return fetch(target, { method: "POST", redirect: "error", headers: { "content-type": "application/json", ...(secret ? { "X-Telegram-Bot-Api-Secret-Token": secret } : {}) }, body: JSON.stringify(update) });
    },
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
function assertLocal(target) {
  const url = new URL(target);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password) throw new Error("Only HTTP loopback webhooks are allowed");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fake = await startFakeTelegram({ port: Number(process.env.PORT || 8081) });
  console.log(`Fake Telegram Bot API: ${fake.url} (any fake token accepted)`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await fake.close(); });
}
