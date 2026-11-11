import "server-only";
import { z } from "zod";
const schema = z.object({
  NEAR_NETWORK: z.enum(["testnet", "sandbox", "mainnet"]).default("testnet"),
  NEAR_RPC_URL: z.string().url().default("https://rpc.testnet.near.org"),
  CORE_CONTRACT_ID: z.string().default("core.tradewind-demo.testnet"),
  USDC_CONTRACT_ID: z.string().default("sample-usdc.testnet"),
  ATTESTER_ACCOUNT_ID: z.string().default(""), ATTESTER_PRIVATE_KEY: z.string().default(""),
  NEARAI_API_KEY: z.string().default(""),
  NEARAI_MODEL_TEXT: z.string().default("deepseek/deepseek-v3.2"),
  NEARAI_MODEL_VISION: z.string().default("Qwen/Qwen3-VL-30B-A3B-Instruct"),
  NEARAI_BASE_URL: z.string().url().default("https://cloud-api.near.ai/v1"),
  DATABASE_PATH: z.string().default("./data/tradewind.db"),
  SESSION_SECRET: z.string().default(""), PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  AI_MODE: z.enum(["live", "mock"]).optional(),
});
export function env() {
  // Empty .env.example entries behave like unset optional configuration.
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== "")));
  if (!parsed.success) throw new Error("Invalid server environment configuration");
  const e = parsed.data;
  const rpc = process.env.NEAR_RPC_URL || (e.NEAR_NETWORK === "mainnet" ? "https://rpc.mainnet.near.org" : e.NEAR_NETWORK === "sandbox" ? "http://127.0.0.1:3030" : e.NEAR_RPC_URL);
  return { ...e, NEAR_RPC_URL: rpc, AI_MODE: e.AI_MODE ?? (e.NEARAI_API_KEY ? "live" : "mock") };
}
