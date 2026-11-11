import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { makeFixtures } from "@tradewind/core";
import { AnyChainPayment } from "../src/components/any-chain-payment";
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../src/components/invoice-flows", () => ({ DirectPayment: ({ amountUnits }: { amountUnits: string }) => <p>Direct wallet amount: {amountUnits}</p> }));
vi.mock("qrcode", () => ({ default: { toString: vi.fn().mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"></svg>') } }));
const invoice = () => makeFixtures().invoices.find(i => i.id === "TW-0042")!;
const refund = `0x${"1".repeat(40)}`;
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });
function show(part = false, preview = true, liveAllowed = false) {
  return render(<AnyChainPayment invoice={invoice()} minPayment="1000000" liveAllowed={liveAllowed} preview={preview} initialPart={part} />);
}
it("labels preview honestly, has no deposit button, and preselects part", () => {
  show(true);
  expect(screen.getByText("1Click is mainnet-only — preview quote, no deposit address on testnet")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Get deposit address" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Pay part" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Preview quote" })).toBeDisabled();
});
it("validates part minimum/cap and shares the selected amount with direct NEAR payment", () => {
  show(true);
  const amount = screen.getByLabelText("USDC amount");
  fireEvent.change(amount, { target: { value: "0.5" } }); expect(screen.getByRole("alert")).toHaveTextContent("min_payment");
  fireEvent.change(amount, { target: { value: "11" } }); expect(screen.getByRole("alert")).toHaveTextContent("outstanding");
  fireEvent.change(amount, { target: { value: "6" } });
  fireEvent.click(screen.getByRole("button", { name: "NEAR" }));
  expect(screen.getByText("Direct wallet amount: 6000000")).toBeInTheDocument();
});
it("only sends live:true for Get deposit address, never Preview quote", async () => {
  const fetcher = vi.fn().mockImplementation(async (_url, init) => {
    const req = JSON.parse(init.body);
    return Response.json({ dry: true, preview: false, amountIn: "10100000", amountInFormatted: "10.1", minAmountIn: "10000000", amountOut: req.amount, timeEstimate: 120, deadline: "2026-11-11T00:30:00Z", path: "A" });
  });
  vi.stubGlobal("fetch", fetcher); show(false, false, true);
  fireEvent.change(screen.getByLabelText("Refund address on Base"), { target: { value: refund } });
  fireEvent.click(screen.getByRole("button", { name: "Preview quote" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await screen.findByText(/You send/);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ live: false, amount: "10000000" });
  fireEvent.click(screen.getByRole("button", { name: "Get deposit address" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[1][1].body).live).toBe(true);
});
it("shows deposit address and QR but not confirmed delivery for unsettled SUCCESS", async () => {
  const fetcher = vi.fn().mockImplementation(async (url: string) => url.endsWith("/status")
    ? Response.json({ status: "SUCCESS", label: "Delivered on NEAR — awaiting invoice settlement", settlement: { confirmed: false }, swapDetails: { originChainTxHashes: [], nearTxHashes: [] } })
    : Response.json({ pid: "pid", dry: false, preview: false, depositAddress: refund, depositMemo: "123", amountIn: "10100000", amountInFormatted: "10.1", minAmountIn: "10000000", amountOut: "10000000", timeEstimate: 120, deadline: "2026-11-11T00:30:00Z", path: "A" }));
  vi.stubGlobal("fetch", fetcher); show(false, false, true);
  fireEvent.change(screen.getByLabelText("Refund address on Base"), { target: { value: refund } });
  fireEvent.click(screen.getByRole("button", { name: "Get deposit address" }));
  await screen.findByText("Real cross-chain payment");
  expect(await screen.findByAltText("Deposit address QR")).toBeInTheDocument();
  expect(await screen.findByText("Delivered on NEAR — awaiting invoice settlement")).toBeInTheDocument();
  expect(screen.queryByText("Payment recorded by the invoice contract.")).not.toBeInTheDocument();
  expect(screen.getByText(/Required deposit memo/)).toHaveTextContent("123");
  expect(screen.queryByRole("button", { name: "Get deposit address" })).not.toBeInTheDocument();
});
