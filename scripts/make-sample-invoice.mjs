// Run from the repository root: node scripts/make-sample-invoice.mjs [output-directory]
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
const out = process.argv[2] || "apps/web/fixtures";
await mkdir(out, { recursive: true });
for (const rejected of [false, true]) {
  const pdf = await PDFDocument.create(), page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("SAMPLE", { x: 100, y: 300, size: 100, rotate: degrees(35), color: rgb(.9, .3, .3), opacity: .18, font });
  const lines = ["SAMPLE - not a real invoice", "Seller: Sample Cashew Exports Ltd (sample)", "Buyer: Gulf Foods Trading (sample)", "Invoice: TW-0042", "Issued: 2026-11-01", "Due: 2026-12-31", "Net 60", "Currency: USDC", "cashew kernels W320 2 x 3.00 = 6.00", `cashew kernels W320 1 x ${rejected ? "3.00 = 3.00" : "4.00 = 4.00"}`, "Tax: 0.00", "Total: 10.00 USDC"];
  lines.forEach((line, i) => page.drawText(line, { x: 45, y: 735 - i * 32, size: 15, font }));
  await writeFile(`${out}/sample-invoice-TW-0042${rejected ? "-rejected" : ""}.pdf`, await pdf.save());
}
