import { env } from "@/server/env";
import { jsonError } from "@/server/errors";
export const runtime = "nodejs";
export async function GET() {
  try { const e = env(); return Response.json({ ok: true, network: e.NEAR_NETWORK, contract: e.CORE_CONTRACT_ID, ai_mode: e.AI_MODE, last_indexed_block: null }); }
  catch (e) { return jsonError(e); }
}
