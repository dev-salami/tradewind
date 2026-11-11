import "server-only";
import { env } from "../env";
export const VERIFIABLE_MODELS = ["deepseek/deepseek-v3.2", "moonshotai/kimi-k3", "Qwen/Qwen3-VL-30B-A3B-Instruct"] as const;
let cache: { expires: number; entries: { id: string; metadata?: { verifiable?: boolean } }[] } | undefined;
export function clearModelCache() { cache = undefined; }
export async function assertVerifiableModel(modelId: string) {
  if (!cache || cache.expires <= Date.now()) {
    try {
      const response = await fetch(`${env().NEARAI_BASE_URL}/model/list`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("Model catalog unavailable");
      const body = await response.json();
      const entries = Array.isArray(body) ? body : body.data ?? body.models;
      if (!Array.isArray(entries)) throw new Error("Invalid catalog");
      cache = { expires: Date.now() + 600_000, entries: entries.map(m => ({ id: m.modelId ?? m.id, metadata: m.metadata })) };
    } catch {
      if (!(VERIFIABLE_MODELS as readonly string[]).includes(modelId)) throw new Error("Model is not verifiable");
      return modelId;
    }
  }
  if (!cache.entries.some(m => m.id === modelId && m.metadata?.verifiable === true)) throw new Error("Model is not verifiable");
  return modelId;
}
