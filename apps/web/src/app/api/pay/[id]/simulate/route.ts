import { payResponse, simulatePayment } from "@/server/pay";
export const runtime = "nodejs";
export async function POST(request: Request) { return payResponse(() => simulatePayment(request)); }
