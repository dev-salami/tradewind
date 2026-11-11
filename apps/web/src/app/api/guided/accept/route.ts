import { guidedPost } from "@/server/guided/routes";
export const runtime = "nodejs";
export function POST(request: Request) { return guidedPost("accept", request); }
