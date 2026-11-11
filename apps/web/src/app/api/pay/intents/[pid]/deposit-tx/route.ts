import { depositTransaction, payResponse } from "@/server/pay";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params;
  return payResponse(() => depositTransaction(request, pid));
}
