import { webcrypto, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { makeFixtures, fixtureConfig } from "@tradewind/core";
import { hashPdf } from "../src/components/pdf-hash";
import { PdfPicker } from "../src/components/pdf-picker";
import { MainnetRuns } from "../src/components/mainnet-runs";
import { AppShell } from "../src/components/chrome";
import { ExporterDashboard } from "../src/components/exporter-dashboard";
import { InvoiceNftPreview } from "../src/components/invoice-nft-preview";
import { WaterfallBars } from "../src/components/waterfall";
import NewInvoice from "../src/app/app/new/page";

const wallet = vi.hoisted(() => ({ accountId: null as string | null, connect: vi.fn(), callView: vi.fn(), revision: 0 }));
vi.mock("../src/components/wallet-provider", () => ({ useWallet: () => wallet, WalletMenu: () => <button>Wallet</button> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app" }));
vi.mock("../src/components/guided-mode", () => ({ GuidedNavLink: () => null }));
vi.mock("../src/components/create-invoice-flow", () => ({ CreateInvoiceFlow: () => null }));

function pdf(name = "invoice.pdf", contents = "%PDF-1.7 sample") {
  const bytes = new TextEncoder().encode(contents);
  return Object.assign(new File([contents], name, { type: "application/pdf" }), { arrayBuffer: async () => bytes.buffer });
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DATA_SOURCE", "rpc");
  vi.stubGlobal("crypto", webcrypto);
  wallet.accountId = null; wallet.connect.mockReset(); wallet.callView.mockReset();
  wallet.callView.mockResolvedValue(null);
});

describe("browser PDF fingerprint", () => {
  it("uses WebCrypto SHA-256 over the exact bytes and returns padded lowercase hex", async () => {
    expect(await hashPdf(pdf("invoice.pdf", "abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await hashPdf(pdf())).toBe(createHash("sha256").update("%PDF-1.7 sample").digest("hex"));
  });
  it("surfaces crypto failures to the caller", async () => {
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn().mockRejectedValue(new Error("Unavailable")) } });
    await expect(hashPdf(pdf())).rejects.toThrow("Unavailable");
  });
  it.each([true, false])("displays before upload and submits doc_hash_client (server hash: %s)", async serverHash => {
    wallet.accountId = "exporter.testnet";
    const hash = await hashPdf(pdf());
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ draft_id: "draft", ...(serverHash ? { doc_hash: hash } : {}), extracted: {}, checks: [], reasons: [], signature: "sample", mock: true }));
    vi.stubGlobal("fetch", fetchMock);
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    render(<NewInvoice />);
    fireEvent.change(screen.getByLabelText("Invoice PDF", { selector: "input" }), { target: { files: [pdf()] } });
    expect(await screen.findByText(/Document fingerprint:/)).toHaveTextContent(`${hash.slice(0, 4)}…${hash.slice(-4)}`);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Copy fingerprint" }));
    expect(copy).toHaveBeenCalledWith(hash);
    fireEvent.click(screen.getByRole("button", { name: "Upload & check PDF" }));
    await screen.findByText("Preview:", { exact: false });
    expect((fetchMock.mock.calls[0][1].body as FormData).get("doc_hash_client")).toBe(hash);
    expect(!!screen.queryByText(/Matches server fingerprint/)).toBe(serverHash);
  });
  it("rejects a mismatched server hash without reporting success", async () => {
    wallet.accountId = "exporter.testnet";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ doc_hash: "wrong" })));
    render(<NewInvoice />);
    fireEvent.change(screen.getByLabelText("Invoice PDF", { selector: "input" }), { target: { files: [pdf()] } });
    await screen.findByText(/Document fingerprint:/);
    fireEvent.click(screen.getByRole("button", { name: "Upload & check PDF" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("fingerprint mismatch");
    expect(screen.queryByText(/Matches server/)).toBeNull();
  });
});

describe("PDF drop zone", () => {
  it("supports click, drop, metadata and removal with a keyboard-native button", () => {
    const change = vi.fn(), file = pdf();
    const { rerender } = render(<PdfPicker label="Invoice PDF" onChange={change} />);
    const input = screen.getByLabelText("Invoice PDF", { selector: "input" });
    const click = vi.spyOn(input, "click");
    const zone = screen.getByRole("button", { name: /Invoice PDF/ });
    zone.focus(); expect(zone).toHaveFocus(); expect(zone.tagName).toBe("BUTTON");
    fireEvent.click(zone); expect(click).toHaveBeenCalledOnce();
    fireEvent.drop(zone, { dataTransfer: { files: [file] } }); expect(change).toHaveBeenLastCalledWith(file);
    rerender(<PdfPicker label="Invoice PDF" onChange={change} file={file} />);
    expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
    expect(screen.getByText(/KB · application\/pdf/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Invoice PDF" })); expect(change).toHaveBeenLastCalledWith(undefined);
  });
  it("validates both click and dropped files, including size", () => {
    const change = vi.fn();
    render(<PdfPicker label="Shipping PDF" onChange={change} />);
    fireEvent.change(screen.getByLabelText("Shipping PDF", { selector: "input" }), { target: { files: [new File(["text"], "shipping.txt", { type: "text/plain" })] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a PDF");
    const huge = pdf(); Object.defineProperty(huge, "size", { value: 6 * 1024 * 1024 });
    fireEvent.drop(screen.getByRole("button", { name: /Shipping PDF/ }), { dataTransfer: { files: [huge] } });
    expect(screen.getByRole("alert")).toHaveTextContent("too large"); expect(change).toHaveBeenLastCalledWith(undefined);
  });
});

describe("dashboard onboarding", () => {
  it("connects or opts into a clearly badged sample dashboard without a wallet", () => {
    render(<ExporterDashboard sample={<p>Fixture dashboard</p>} />);
    expect(screen.queryByText("Fixture dashboard")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" })); expect(wallet.connect).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Explore the demo (sample data)" }));
    expect(screen.getByText("Sample data")).toBeInTheDocument(); expect(screen.getByText("Fixture dashboard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Exit sample data" }));
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
  });
  it("offers first-invoice guidance for an empty connected wallet", async () => {
    wallet.accountId = "exporter.testnet";
    wallet.callView.mockImplementation(async (method: string) => method === "invoices_by_exporter" ? [] : method === "get_config" ? fixtureConfig : "0");
    render(<ExporterDashboard />);
    expect(await screen.findByRole("link", { name: "Create your first invoice" })).toHaveAttribute("href", "/app/new");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText("Sample data")).toBeNull();
  });
});

describe("mobile navigation", () => {
  it("renders a menu controlling all navigation items at 360px", () => {
    vi.stubGlobal("innerWidth", 360);
    render(<AppShell network="testnet"><p>Dashboard</p></AppShell>);
    const button = screen.getByRole("button", { name: "Menu" }), nav = screen.getByRole("navigation");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", nav.id);
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true"); expect(nav).toHaveClass("tw-nav-open");
    for (const label of ["Dashboard", "New invoice", "Pool", "Buyers", "Receipts", "Settings"]) expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    fireEvent.keyDown(nav, { key: "Escape" }); expect(button).toHaveAttribute("aria-expanded", "false"); expect(button).toHaveFocus();
    // JSDOM has no layout engine: guard the actual mobile layout rules as well.
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("@media (max-width: 639px)"); expect(css).toContain(".tw .tw-nav { display: none;"); expect(css).toContain("flex-direction: column; align-items: stretch;");
  });
});

describe("payment split ribbons", () => {
  it("preserves proportional SVG thickness, including tiny fees and overpayments", () => {
    render(<WaterfallBars split={{ to_pool_principal: "700", to_pool_fee: "20", to_protocol: "10", to_exporter: "260", overpaid: "10" }} />);
    const ribbons = screen.getAllByTestId("waterfall-segment");
    expect(ribbons.map(n => Number(n.getAttribute("data-width")))).toEqual([70, 2, 1, 26, 1]);
    expect(Number(ribbons[0].getAttribute("data-thickness")) / Number(ribbons[2].getAttribute("data-thickness"))).toBeCloseTo(70);
    for (const ribbon of ribbons) { expect(ribbon.tagName).toBe("path"); expect(ribbon.getAttribute("d")).toContain(" C"); }
    expect(screen.getAllByText("LP yield").length).toBeGreaterThan(0);
  });
});

describe("mainnet stats", () => {
  it("renders nothing for absent, empty or invalid data", () => {
    vi.stubEnv("NEXT_PUBLIC_MAINNET_RUNS_JSON", "");
    const { container, rerender } = render(<MainnetRuns />);
    expect(container).toBeEmptyDOMElement();
    for (const json of ["", "{}", "broken", '{"runs":-1,"invoices":2,"volume_usdc":3}']) { rerender(<MainnetRuns json={json} />); expect(container).toBeEmptyDOMElement(); }
  });
  it("renders supplied or environment-backed mainnet stats", () => {
    const json = JSON.stringify({ runs: 3, invoices: 8, volume_usdc: 1234.5 });
    const { rerender } = render(<MainnetRuns json={json} />);
    expect(screen.getByRole("region", { name: "Mainnet runs" })).toHaveTextContent("1,234.5");
    vi.stubEnv("NEXT_PUBLIC_MAINNET_RUNS_JSON", json); rerender(<MainnetRuns />);
    expect(screen.getByText("Completed runs")).toBeInTheDocument();
  });
});

describe("invoice NFT preview", () => {
  it("renders contract data-URI media when available", async () => {
    const invoice = makeFixtures().invoices[0], media = "data:image/svg+xml;base64,PHN2Zy8+";
    wallet.callView.mockResolvedValue({ metadata: { media } });
    render(<InvoiceNftPreview invoice={invoice} />);
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src", media));
    expect(wallet.callView).toHaveBeenCalledWith("nft_token", { token_id: invoice.id }, undefined);
  });
  it("falls back to an SVG with the invoice details when metadata is missing", async () => {
    const invoice = makeFixtures().invoices[0];
    render(<InvoiceNftPreview invoice={invoice} />);
    await waitFor(() => expect(wallet.callView).toHaveBeenCalled());
    const preview = screen.getByRole("img");
    expect(preview.tagName).toBe("svg");
    expect(preview).toHaveTextContent(invoice.id); expect(preview).toHaveTextContent("Tradewind"); expect(preview).toHaveTextContent("Due:"); expect(preview).toHaveTextContent(invoice.status);
  });
});

import { isMockVerification } from "@/lib/verify-signature";
describe("mock verdict detection", () => {
  it("flags test-key ECDSA mock verdicts and legacy mock algo, not real signers", () => {
    expect(isMockVerification({ signing_algo: "ecdsa", model_id: "mock/sample-parser", signing_address: "0x2C7536E3605D9C16A7A3D7B1898E529396A65C23" })).toBe(true);
    expect(isMockVerification({ signing_algo: "mock", model_id: "seed-mock" })).toBe(true);
    expect(isMockVerification({ signing_algo: "ecdsa", model_id: "z-ai/glm-5.3-flash", signing_address: "0x1111111111111111111111111111111111111111" })).toBe(false);
  });
});
