import "server-only";
import { z } from "zod";
const schema = z.object({
  NEAR_NETWORK: z.enum(["testnet", "sandbox", "mainnet"]).default("testnet"),
  NEAR_RPC_URL: z.string().url().default("https://rpc.testnet.near.org"),
  CORE_CONTRACT_ID: z.string().default("core.tradewind-demo.testnet"),
  USDC_CONTRACT_ID: z.string().default("sample-usdc.testnet"),
  ATTESTER_ACCOUNT_ID: z.string().default(""), ATTESTER_PRIVATE_KEY: z.string().default(""),
  NEARAI_API_KEY: z.string().default(""),
  NEARAI_MODEL_TEXT: z.string().default("z-ai/glm-5.3-flash"),
  NEARAI_PCCS_URL: z.string().url().default("https://pccs.phala.network"),
  NEARAI_E2EE: z.enum(["0", "1"]).default("1"),
  NEARAI_MODEL_VISION: z.string().default("Qwen/Qwen3-VL-30B-A3B-Instruct"),
  NEARAI_BASE_URL: z.string().url().default("https://cloud-api.near.ai/v1"),
  DATABASE_PATH: z.string().default("./data/tradewind.db"),
  ONECLICK_BASE_URL: z.string().url().default("https://1click.chaindefuser.com"),
  ONECLICK_JWT: z.string().optional(), ONECLICK_LIVE_QUOTES: z.string().default("0"),
  SETTLEMENT_PATH: z.enum(["A", "B"]).default("A"), RELAYER_ACCOUNT_ID: z.string().optional(),
  SESSION_SECRET: z.string().default(""), PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  AI_MODE: z.enum(["live", "mock"]).optional(),
});
export function env() {
  // Empty .env.example entries behave like unset optional configuration.
  const values = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ""));
  // One network/contract for both wallet and verification when only public vars are set.
  values.NEAR_NETWORK ||= process.env.NEXT_PUBLIC_NEAR_NETWORK;
  values.CORE_CONTRACT_ID ||= process.env.NEXT_PUBLIC_CORE_CONTRACT_ID;
  values.USDC_CONTRACT_ID ||= process.env.NEXT_PUBLIC_USDC_CONTRACT_ID;
  values.NEAR_RPC_URL ||= process.env.NEXT_PUBLIC_NEAR_RPC_URL;
  const parsed = schema.safeParse(values);
  if (!parsed.success) throw new Error("Invalid server environment configuration");
  const e = parsed.data;
  const rpc = process.env.NEAR_RPC_URL || process.env.NEXT_PUBLIC_NEAR_RPC_URL || (e.NEAR_NETWORK === "mainnet" ? "https://rpc.mainnet.near.org" : e.NEAR_NETWORK === "sandbox" ? "http://127.0.0.1:3030" : e.NEAR_RPC_URL);
  return { ...e, NEAR_RPC_URL: rpc, AI_MODE: e.AI_MODE ?? (e.NEARAI_API_KEY ? "live" : "mock") };
}
