# Telegram: local harness and deployment

## No bot or token required locally

Use Node 22.13+ and installed workspace dependencies (`npm ci` in an environment
where dependency downloads are permitted). The harness itself uses localhost only:

```sh
node scripts/telegram-harness.mjs
npm test --workspace=@tradewind/web -- tests/telegram-harness.test.ts
```

The demo starts an ephemeral loopback Bot API server and runs the scripted Vitest
flow against the actual grammy bot and secret-checked `/api/telegram/webhook`
handler. It prints sent messages, edited cards and callback answers. It links a
fixture account, delivers an advance card, approves once, rejects replay, shows
pool/invoices, sends reminders and payment cards, then unlinks. Chain reads and
the signer are injected fixture dependencies; **no transaction is submitted**.
SQLite uses a temporary file removed after the run. No real Telegram account,
BotFather action, credentials, NEAR RPC or external network is needed.

The tests additionally cover expired/invalid linking, concurrent taps, expired
buttons, changed-terms revocation, own-invoice filtering, stop cleanup, and real
worker indexer/reminder jobs. The payment snapshots advance from zero to one to
three parts, with unchanged re-runs proving deduplication. “Payment X of N” uses
the number of payments observed in that snapshot, not a predicted final count.
Reminder windows follow core: T−7, T−1, due, T+1 and T+7 **contract days** (fixture
days are accelerated), not T−3.

### Standalone fake API

```sh
PORT=8081 node scripts/fake-telegram.mjs
```

Or import `startFakeTelegram({port: 0})` from that module. It returns
`{url, calls, pushUpdate, close}`. `calls` records method/parsed parameters,
including JSON-decoded `reply_markup`. `pushUpdate(update, webhookUrl?, secret?)`
posts only to an HTTP loopback URL; absent overrides it uses the last
`setWebhook` URL and `secret_token`. Redirects are rejected. `close()` is async.
The supported methods are getMe, sendMessage, editMessageText,
editMessageReplyMarkup, answerCallbackQuery, setWebhook and deleteWebhook.
Any token string is accepted; use the obviously fake `000000:FAKE`.

### Exact harness environment

The demo/test runner sets these automatically:

| Variable | Local value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | `000000:FAKE` |
| `TELEGRAM_API_ROOT` | Ephemeral `http://127.0.0.1:<port>` |
| `TELEGRAM_WEBHOOK_SECRET` | `fixture-secret` |
| `TELEGRAM_DEMO_API_ROOT` | Internal demo override pointing at its fake server |

`PORT` controls only the standalone fake server (default 8081). No other env vars
are required for the harness. HTTPS origins are accepted for `TELEGRAM_API_ROOT`;
plaintext origins are limited to localhost, 127.0.0.1 and ::1. The default is
`https://api.telegram.org`. Do not use a real token with an untrusted API root.

## Flow safety

Linking enables invoice notifications and buyer reminders, not automatic wallet
authority. Development links are unverified and notifications-only. An advance
callback requires a verified link and exporter wallet opt-in for the configured
bot account. Buyer payments always require the buyer's wallet.

Buttons expire after 30 minutes and are atomically claimed before signing;
replayed, concurrent, expired or revoked buttons receive a “Button unavailable”
alert. A failed/uncertain send is never retried by tapping again. When refreshed
terms are issued, all earlier unused buttons for that invoice are revoked.
`/stop` removes the user's links, revokes pending buttons and skips pending
notifications for that chat; on-chain opt-in must be revoked separately in app
settings.

## What needs a real bot token

Only a real Telegram deployment needs a **BotFather token**, bot username,
public HTTPS **webhook URL**, and **test accounts** for the exporter/buyer.
Do not create these for the local harness. Deployment variables are:

* `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`
* `TELEGRAM_API_ROOT=https://api.telegram.org` (or omit for the default)
* `PUBLIC_BASE_URL=https://<application-host>`; register
  `${PUBLIC_BASE_URL}/api/telegram/webhook` with Telegram `setWebhook`, passing
  `secret_token` equal to `TELEGRAM_WEBHOOK_SECRET`.
* `DATABASE_PATH` for shared persistent app/worker SQLite storage.
* `NEAR_NETWORK`, `NEAR_RPC_URL`, `CORE_CONTRACT_ID` for live chain reads.
* `BOT_ACCOUNT_ID`, `BOT_PRIVATE_KEY` only for live opt-in advance signing;
  `SESSION_SECRET` for verified wallet-authenticated linking.

Without `TELEGRAM_BOT_TOKEN`, delivery is skipped and the webhook reports
`skipped_no_token` after secret validation. Never commit real tokens or keys.
