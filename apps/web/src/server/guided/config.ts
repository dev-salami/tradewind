import "server-only";
import { env } from "../env";
import { ApiError } from "../errors";

export function guidedConfig() {
  // Check the raw network first: mainnet must always produce 403, even with bad config.
  if ((process.env.NEAR_NETWORK || process.env.NEXT_PUBLIC_NEAR_NETWORK) === "mainnet") throw new ApiError("Guided mode is unavailable on mainnet", 403);
  const exporter = process.env.GUIDED_EXPORTER_ACCOUNT_ID;
  const exporterKey = process.env.GUIDED_EXPORTER_PRIVATE_KEY;
  const buyer = process.env.GUIDED_BUYER_ACCOUNT_ID;
  const buyerKey = process.env.GUIDED_BUYER_PRIVATE_KEY;
  if (process.env.GUIDED_ENABLED !== "1" || !exporter || !exporterKey || !buyer || !buyerKey || exporter === buyer) {
    throw new ApiError("guided mode not configured", 503);
  }
  const e = env();
  if (e.NEAR_NETWORK !== "testnet" && e.NEAR_NETWORK !== "sandbox") throw new ApiError("Guided mode requires testnet or sandbox", 403);
  return { ...e, exporter, exporterKey, buyer, buyerKey };
}
