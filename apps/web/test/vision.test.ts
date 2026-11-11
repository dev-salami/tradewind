import { expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { runVerification } from "../src/server/nearai/verify-flow";
import { formSchema } from "../src/server/nearai/prompt";
import { verifyPublicSignature } from "../src/lib/verify-signature";
import { privateKeyToAccount } from "viem/accounts";
import { PUBLIC_TEST_SIGNER_KEY } from "../src/server/nearai/mock";

it("image-only PDF routes to mock vision without 422; public test signature recovers", async () => {
  vi.stubEnv("AI_MODE", "mock"); vi.stubEnv("NEAR_NETWORK", "sandbox");
  const pdf = await PDFDocument.create(), page = pdf.addPage([200, 200]);
  const canvas = createCanvas(200, 200), context = canvas.getContext("2d");
  context.fillStyle = "white"; context.fillRect(0, 0, 200, 200);
  context.fillStyle = "black"; context.fillRect(20, 20, 100, 5);
  const image = await pdf.embedPng(canvas.toBuffer("image/png"));
  page.drawImage(image, { x: 0, y: 0, width: 200, height: 200 });
  const bytes = await pdf.save();
  const result = await runVerification({ invoiceId: "scan", pdfBytes: bytes, formFields: formSchema.parse({}) });
  expect(result.scanned).toBe(true);
  expect(result.verdict).not.toBe("pass");
  expect(result.reasons).toContain("MOCK vision — scanned PDF not read");
  expect(result.signature_kind).toBe("mock");
  expect(result.signing_address.toLowerCase()).toBe("0x2c7536e3605d9c16a7a3d7b1898e529396a65c23");
  await verifyPublicSignature(result);
  expect(result.signature).toBe(await privateKeyToAccount(PUBLIC_TEST_SIGNER_KEY).signMessage({ message: result.text }));
  expect(bytes.every(b => b === 0)).toBe(true);
});
