// @vitest-environment node
import { expect, it } from "vitest";
import { createServer } from "node:http";
// @ts-expect-error Dependency-free JavaScript fixture module
import { startFakeTelegram } from "../../../scripts/fake-telegram.mjs";

it("implements Bot API JSON/form calls and pushes secret-authenticated updates only locally", async () => {
  const fake = await startFakeTelegram({ port: 0 });
  const received: { secret: string | string[] | undefined; body: string }[] = [];
  const webhook = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ secret: req.headers["x-telegram-bot-api-secret-token"], body: Buffer.concat(chunks).toString() });
    res.end('{"ok":true}');
  });
  await new Promise<void>(resolve => webhook.listen(0, "127.0.0.1", resolve));
  try {
    const address = webhook.address();
    if (!address || typeof address === "string") throw new Error("No listener");
    const url = `http://127.0.0.1:${address.port}/api/telegram/webhook`;
    const call = async (method: string, params: object) => (await fetch(`${fake.url}/bot000000:FAKE/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) })).json();
    expect(await call("getMe", {})).toMatchObject({ ok: true, result: { is_bot: true } });
    const markup = { inline_keyboard: [[{ text: "Approve", callback_data: "fixture" }]] };
    const sent = await call("sendMessage", { chat_id: 123, text: "Fixture card", reply_markup: JSON.stringify(markup) });
    expect(sent).toMatchObject({ ok: true, result: { message_id: 1, chat: { id: 123 }, reply_markup: markup } });
    const form = new URLSearchParams({ chat_id: "123", message_id: "1", reply_markup: JSON.stringify(markup) });
    expect(await (await fetch(`${fake.url}/botFAKE/editMessageReplyMarkup`, { method: "POST", body: form })).json()).toMatchObject({ ok: true, result: { message_id: 1 } });
    expect(fake.calls.at(-1).params.reply_markup).toEqual(markup);
    expect(await call("editMessageText", { chat_id: 123, message_id: 1, text: "Sent" })).toMatchObject({ result: { message_id: 1, text: "Sent" } });
    expect(await call("answerCallbackQuery", { callback_query_id: "fixture" })).toEqual({ ok: true, result: true });
    expect(await call("setWebhook", { url, secret_token: "fixture-secret" })).toEqual({ ok: true, result: true });
    expect((await fake.pushUpdate({ update_id: 1 })).status).toBe(200);
    expect(received).toEqual([{ secret: "fixture-secret", body: '{"update_id":1}' }]);
    await expect(fake.pushUpdate({}, "https://example.test")).rejects.toThrow("loopback");
    expect(await call("setWebhook", { url: "http://example.test" })).toMatchObject({ ok: false });
    expect(await call("deleteWebhook", {})).toEqual({ ok: true, result: true });
    await expect(fake.pushUpdate({})).rejects.toThrow("Set a localhost webhook");
  } finally {
    await fake.close();
    await new Promise<void>((resolve, reject) => webhook.close(error => error ? reject(error) : resolve()));
  }
});
