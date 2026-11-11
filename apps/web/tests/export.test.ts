// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureData, invoicesCsv, paymentsCsv, SAMPLE_EXPORTER } from "@tradewind/core";
import { GET } from "../src/app/api/export/[kind]/route";
import { data } from "../src/lib/data";

vi.mock("../src/lib/data", async importOriginal => ({ ...await importOriginal<typeof import("../src/lib/data")>(), data: vi.fn() }));
let ip = 0;
function request(kind = "invoices", account: string | null = SAMPLE_EXPORTER, hostIp = `export-${++ip}`) {
  const query = account === null ? "" : `?exporter=${encodeURIComponent(account)}`;
  return GET(new Request(`http://localhost/api/export/${kind}${query}`, { headers: { "x-forwarded-for": hostIp } }), { params: Promise.resolve({ kind }) });
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DATA_SOURCE", "fixtures");
  vi.mocked(data).mockReturnValue(fixtureData());
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("public CSV download route", () => {
  it.each([null, "", "a", "UPPER.near", "a..near", "a_-b.near", "-bad.near", "bad.near-", "bad/account", 'bad".near', "bad\r\n.near", "a".repeat(65)])("rejects invalid exporter %j even in fixture mode", async account => {
    expect((await request("invoices", account)).status).toBe(400);
    expect(data).not.toHaveBeenCalled();
  });
  it.each(["other", "Invoices", "payments.csv"])("rejects invalid kind %s", async kind => {
    expect((await request(kind)).status).toBe(400);
    expect(data).not.toHaveBeenCalled();
  });
  it.each(["invoices", "payments"])("downloads %s sample CSV with attachment and no-store headers, without auth", async kind => {
    const source = fixtureData(), byExporter = vi.spyOn(source, "invoicesByExporter");
    vi.mocked(data).mockReturnValue(source);
    const response = await request(kind, "other.near");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="tradewind-${kind}-${SAMPLE_EXPORTER}-sample.csv"`);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(byExporter).toHaveBeenCalledWith(SAMPLE_EXPORTER);
    const invoices = await fixtureData().invoicesByExporter(SAMPLE_EXPORTER);
    const text = await response.text();
    expect(text).toBe(kind === "invoices" ? invoicesCsv(invoices) : paymentsCsv(invoices));
    expect(text).toContain("TW-0035");
    expect(text).toContain(kind === "invoices" ? "2.000000" : "TW-0035-sample-part-1");
  });
  it.each(["ab", "exporter.near", "sub-account_1.testnet", "a".repeat(64)])("uses the requested live exporter %s without sample labeling", async account => {
    vi.stubEnv("NEXT_PUBLIC_DATA_SOURCE", "rpc");
    const source = fixtureData(), byExporter = vi.spyOn(source, "invoicesByExporter").mockResolvedValue([]);
    vi.mocked(data).mockReturnValue(source);
    const response = await request("invoices", account);
    expect(response.status).toBe(200);
    expect(byExporter).toHaveBeenCalledWith(account);
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="tradewind-invoices-${account}.csv"`);
    expect(await response.text()).toBe(invoicesCsv([]));
  });
  it("shares the ten-request bucket across both export kinds per IP", async () => {
    const hostIp = `limited-export-${++ip}`;
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    for (let n = 0; n < 10; n++) expect((await request(n % 2 ? "payments" : "invoices", SAMPLE_EXPORTER, hostIp)).status).toBe(200);
    const response = await request("payments", SAMPLE_EXPORTER, hostIp);
    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(data).toHaveBeenCalledTimes(10);
    expect((await request()).status).toBe(200);
  });
  it("sanitizes data-source failures and never caches them", async () => {
    vi.mocked(data).mockImplementation(() => { throw new Error("private RPC details"); });
    const response = await request();
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Unable to export CSV" });
  });
});
