import { payResponse, quotePayment } from "@/server/pay";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return payResponse(() => quotePayment(request, id));
}
