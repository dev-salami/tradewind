import "server-only";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

// In-memory equivalent of scripts/make-sample-invoice.mjs; no fixture files or uploads.
export async function samplePdf(face: string, tenor: number, invoiceNumber: string) {
  const pdf = await PDFDocument.create(), page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("SAMPLE", { x: 100, y: 300, size: 100, rotate: degrees(35), color: rgb(.9, .3, .3), opacity: .18, font });
  const amount = `${BigInt(face) / 1_000_000n}.${(BigInt(face) % 1_000_000n).toString().padStart(6, "0")}`;
  const issued = "2026-11-01", due = new Date(Date.parse(issued) + tenor * 86_400_000).toISOString().slice(0, 10);
  const lines = ["SAMPLE - not a real invoice", "Seller: Sample Cashew Exports Ltd (sample)", "Buyer: Gulf Foods Trading (sample)", `Invoice: ${invoiceNumber}`, `Issued: ${issued}`, `Due: ${due}`, `Net ${tenor}`, "Currency: USDC", `cashew kernels W320 1 x ${amount} = ${amount}`, "Tax: 0.00", `Total: ${amount} USDC`];
  lines.forEach((line, i) => page.drawText(line, { x: 45, y: 735 - i * 32, size: 15, font }));
  return pdf.save();
}
