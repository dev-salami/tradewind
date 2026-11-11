import { data, isFixtureMode } from "@/lib/data";
import { snapshotHistory } from "@/server/telegram/history";
export const runtime = "nodejs";
export async function GET() { return Response.json(isFixtureMode() ? await data().poolHistory() : snapshotHistory()); }
