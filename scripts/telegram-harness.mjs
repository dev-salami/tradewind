import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startFakeTelegram } from "./fake-telegram.mjs";

// Use the same real-grammy fixture flow as the integration tests, not a second
// implementation of the bot. No signer, RPC service or production env is used.
const fake = await startFakeTelegram({ port: 0 });
try {
  console.log(`Local Telegram demo · ${fake.url} · token 000000:FAKE`);
  const root = fileURLToPath(new URL("../", import.meta.url));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)), "run", "tests/telegram-harness.test.ts", "-t", "scripted demo"], {
    cwd: `${root}apps/web`, stdio: "inherit",
    env: { ...process.env, TELEGRAM_DEMO_API_ROOT: fake.url, TELEGRAM_BOT_TOKEN: "000000:FAKE", TELEGRAM_API_ROOT: fake.url },
  });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => resolve(code ?? 1)); });
  console.log("\n--- Telegram transcript (fixture data; no chain transaction) ---");
  for (const { method, params } of fake.calls) {
    if (!["sendMessage", "editMessageText", "editMessageReplyMarkup", "answerCallbackQuery"].includes(method)) continue;
    console.log(`\n${method} ${JSON.stringify(params)}`);
  }
  if (!fake.calls.length) console.error("No Bot API calls recorded. Install workspace dependencies before running the harness.");
  process.exitCode = code;
} finally { await fake.close(); }
