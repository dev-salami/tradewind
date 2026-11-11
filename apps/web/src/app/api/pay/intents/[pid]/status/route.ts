import { paymentStatus, payResponse } from "@/server/pay";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params;
  return payResponse(() => paymentStatus(pid));
}
