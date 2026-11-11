/** Permit plaintext only on loopback, never on a remote Bot API endpoint. */
export function telegramApiRoot(root = process.env.TELEGRAM_API_ROOT || "https://api.telegram.org") {
  const url = new URL(root);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("TELEGRAM_API_ROOT must be an HTTPS origin or HTTP loopback origin");
  }
  return url.origin;
}
