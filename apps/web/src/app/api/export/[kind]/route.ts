import { invoicesCsv, paymentsCsv, SAMPLE_EXPORTER } from "@tradewind/core";
import { data, isFixtureMode } from "@/lib/data";
import { tokenBucket } from "@/server/rate-limit";

export const runtime = "nodejs";
const allow = tokenBucket();
const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (!allow(ip)) return Response.json({ error: "Too many export requests" }, { status: 429, headers: { ...noStore, "Retry-After": "60" } });
  const { kind } = await context.params;
  const account = new URL(request.url).searchParams.get("exporter");
  if (kind !== "invoices" && kind !== "payments") return Response.json({ error: "Invalid export kind" }, { status: 400, headers: noStore });
  if (!account || account.length < 2 || account.length > 64 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(account)) {
    return Response.json({ error: "Invalid exporter account" }, { status: 400, headers: noStore });
  }
  const sample = isFixtureMode(), exporter = sample ? SAMPLE_EXPORTER : account;
  try {
    const invoices = await data().invoicesByExporter(exporter);
    return new Response(kind === "invoices" ? invoicesCsv(invoices) : paymentsCsv(invoices), {
      headers: {
        ...noStore,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="tradewind-${kind}-${exporter}${sample ? "-sample" : ""}.csv"`,
      },
    });
  } catch {
    return Response.json({ error: "Unable to export CSV" }, { status: 502, headers: noStore });
  }
}
