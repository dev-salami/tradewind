import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { makeFixtures } from "@tradewind/core";
import { AnyChainPayment } from "../src/components/any-chain-payment";
import { RelayerPanel } from "../src/app/ops/relayer-panel";
const state = vi.hoisted(() => ({ accountId: null as string | null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../src/components/wallet-provider", () => ({ useWallet: () => state }));
vi.mock("../src/components/write-controls", () => ({ useView: () => ({ value: { owner: "owner.testnet" } }) }));
vi.mock("../src/components/invoice-flows", () => ({ DirectPayment: () => null }));
vi.mock("qrcode", () => ({ default: { toString: async () => "<svg></svg>" } }));
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); state.accountId = null; });
it("labels simulated delivery honestly and explains the trusted custody boundary", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ dry: true, simulated: true, preview: true, path: "B", amountIn: "10000000", amountInFormatted: "10", minAmountIn: "10000000", amountOut: "10000000", timeEstimate: 1, deadline: "2026-11-11T00:30:00Z" })));
  render(<AnyChainPayment invoice={makeFixtures().invoices.find(i => i.id === "TW-0042")!} minPayment="1000000" liveAllowed preview initialPart={false} />);
  fireEvent.change(screen.getByLabelText("Refund address on Base"), { target: { value: `0x${"1".repeat(40)}` } });
  fireEvent.click(screen.getByRole("button", { name: "Preview quote" }));
  expect(await screen.findByText("Simulated 1Click (local) · Trusted settlement relayer")).toBeInTheDocument();
  expect(screen.getByText(/Trusted settlement relayer forwards to the invoice contract after delivery/)).toHaveTextContent("holds funds in transit");
  expect(screen.getByText(/No real cross-chain funds moved/)).toBeInTheDocument(); expect(screen.queryByText("Real cross-chain payment")).not.toBeInTheDocument();
});
it("hides relayer data from disconnected and non-owner wallets", () => {
  const { rerender } = render(<RelayerPanel />); expect(screen.queryByRole("table")).not.toBeInTheDocument();
  state.accountId = "other.testnet"; rerender(<RelayerPanel />); expect(screen.queryByRole("table")).not.toBeInTheDocument();
  state.accountId = "owner.testnet"; rerender(<RelayerPanel />); expect(screen.getByRole("heading", { name: "Relayer" })).toBeInTheDocument();
});
