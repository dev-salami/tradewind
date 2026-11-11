import "server-only";
import { env } from "../env";
export const VERIFIABLE_MODELS = ["z-ai/glm-5.3-flash", "Qwen/Qwen3-VL-30B-A3B-Instruct", "moonshotai/kimi-k3"] as const;
export interface CatalogModel { id: string; owned_by?: string; is_ready?: boolean }
export function isVerifiableModel(model: CatalogModel) { return !model.id.startsWith("openai/") && ["nearai", "attested 3p"].includes(model.owned_by ?? "") && model.is_ready !== false; }
let cache: { expires: number; entries: CatalogModel[] } | undefined;
export function clearModelCache() { cache = undefined; }
export async function assertVerifiableModel(modelId: string) {
  if (!cache || cache.expires <= Date.now()) {
    try {
      const response = await fetch(`${env().NEARAI_BASE_URL}/models`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("Model catalog unavailable");
      const body = await response.json();
      const entries = Array.isArray(body) ? body : body.data ?? body.models;
      if (!Array.isArray(entries)) throw new Error("Invalid catalog");
      cache = { expires: Date.now() + 600_000, entries };
    } catch {
      if (!(VERIFIABLE_MODELS as readonly string[]).includes(modelId)) throw new Error("Model is not verifiable");
      return modelId;
    }
  }
  // Catalog eligibility is provisional: liveCompletion must verify the chosen model's preflight.
  if (!cache.entries.some(m => m.id === modelId && isVerifiableModel(m))) throw new Error("Model is not verifiable");
  return modelId;
}
