import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuidedMode, GuidedNavLink } from "../src/components/guided-mode";
import { emptyGuidedProgress, GUIDED_STORAGE_KEY, guidedAvailable, guidedStepEnabled, guidedUnits, resumeGuided } from "../src/lib/guided-steps";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_NEAR_NETWORK", "testnet");
  sessionStorage.clear();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("guided step logic", () => {
  it("enables only the next step, never while busy or paused", () => {
    const initial = emptyGuidedProgress();
    expect(guidedStepEnabled(initial, "invoice", false)).toBe(true);
    expect(guidedStepEnabled(initial, "accept", false)).toBe(false);
    const accepted = { ...initial, invoice_id: "TW-1234", next: 2 };
    expect(guidedStepEnabled(accepted, "advance", false)).toBe(true);
    expect(guidedStepEnabled(accepted, "pay", false)).toBe(false);
    expect(guidedStepEnabled(accepted, "advance", true)).toBe(false);
    expect(guidedStepEnabled({ ...accepted, paused: true }, "advance", false)).toBe(false);
    expect(guidedStepEnabled({ ...initial, next: 1 }, "accept", false)).toBe(false);
  });
  it("converts USD without floating-point rounding", () => {
    expect(guidedUnits("10")).toBe("10000000");
    expect(guidedUnits("1.000001")).toBe("1000001");
    expect(guidedUnits("9007199254740993.123456")).toBe("9007199254740993123456");
    for (const value of ["0", "-1", "1.0000001", "1e2", "", "340282366920938463463374607431768211456"]) expect(() => guidedUnits(value)).toThrow();
  });
  it("restores progress from sessionStorage and rejects corrupt data", () => {
    const progress = { invoice_id: "TW-8765", next: 3, paused: false, results: [] };
    sessionStorage.setItem(GUIDED_STORAGE_KEY, JSON.stringify(progress));
    expect(resumeGuided(sessionStorage)).toEqual(progress);
    sessionStorage.setItem(GUIDED_STORAGE_KEY, "broken");
    expect(resumeGuided(sessionStorage)).toEqual(emptyGuidedProgress());
    expect(resumeGuided({ getItem: () => { throw new Error("blocked"); } })).toEqual(emptyGuidedProgress());
  });
  it("requires an affirmative status and a non-mainnet network", () => {
    expect(guidedAvailable("testnet", 200, { available: true })).toBe(true);
    expect(guidedAvailable("mainnet", 200, { available: true })).toBe(false);
    expect(guidedAvailable("testnet", 503, { available: true })).toBe(false);
    expect(guidedAvailable("testnet", 403, {})).toBe(false);
  });
});

describe("guided UI", () => {
  it("hides the page and navigation on mainnet without fetching", () => {
    vi.stubEnv("NEXT_PUBLIC_NEAR_NETWORK", "mainnet");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<><GuidedMode /><GuidedNavLink active={false} /></>);
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([403, 503])("silently hides unavailable guided mode (%s)", async status => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: "unavailable" }, { status }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<><GuidedMode /><GuidedNavLink active={false} /></>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).toHaveBeenCalledWith("/api/guided/status", expect.objectContaining({ method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
  });
  it("runs the loop with the returned ID, preserves mock labels, and resumes payments", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => Response.json(url.endsWith("status") ? { available: true } : { invoice_id: "TW-8765", tx_links: ["https://testnet.nearblocks.io/txns/hash"], ...(url.endsWith("invoice") ? { mock: true, verdict: "pass" } : {}) }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<GuidedMode />);
    fireEvent.click(await screen.findByRole("button", { name: /Create sample invoice/ }));
    await screen.findByText("Mock AI check — not a TEE result");
    expect(screen.getByRole("link", { name: /Invoice TW-8765/ })).toHaveAttribute("href", "/app/i/TW-8765");
    fireEvent.click(screen.getByRole("button", { name: /Buyer accepts/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Request advance/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Request advance/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay full" })).toBeEnabled());
    view.unmount(); render(<GuidedMode />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay full" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Part payment (USD)"), { target: { value: "2.500001" } });
    fireEvent.click(screen.getByRole("button", { name: "Pay part" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/guided/pay", expect.objectContaining({ body: JSON.stringify({ invoice_id: "TW-8765", amount: "2500001" }) })));
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay full" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Pay full" }));
    await screen.findByText(/Full payment submitted/);
    expect(fetchMock).toHaveBeenCalledWith("/api/guided/pay", expect.objectContaining({ body: JSON.stringify({ invoice_id: "TW-8765" }) }));
  });
  it("retains partial transaction links and API errors without enabling another write", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => url.endsWith("status") ? Response.json({ available: true }) : Response.json({ error: "Verification unavailable", invoice_id: "TW-9876", tx_links: ["https://testnet.nearblocks.io/txns/created"] }, { status: 502 })));
    render(<GuidedMode />);
    fireEvent.click(await screen.findByRole("button", { name: /Create sample invoice/ }));
    await screen.findByRole("alert");
    expect(screen.getByText("Verification unavailable")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View on NearBlocks ↗" })).toHaveAttribute("href", "https://testnet.nearblocks.io/txns/created");
    expect(screen.getByRole("button", { name: /Buyer accepts/ })).toBeDisabled();
    expect(resumeGuided(sessionStorage)).toMatchObject({ invoice_id: "TW-9876", paused: true });
  });
  it("disables writes while busy, sends exact face units and pauses after a lost response", async () => {
    let rejectWrite: (reason: Error) => void = () => { throw new Error("No pending write"); };
    const fetchMock = vi.fn().mockImplementation((url: string) => url.endsWith("status") ? Promise.resolve(Response.json({ available: true })) : new Promise<Response>((_resolve, reject) => { rejectWrite = reject; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<GuidedMode />);
    const create = await screen.findByRole("button", { name: /Create sample invoice/ });
    fireEvent.change(screen.getByLabelText("Sample invoice face (USD, optional)"), { target: { value: "12.345678" } });
    fireEvent.click(create);
    expect(create).toBeDisabled();
    expect(screen.getByRole("button", { name: /Buyer accepts/ })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith("/api/guided/invoice", expect.objectContaining({ body: JSON.stringify({ face: "12345678" }) }));
    expect(resumeGuided(sessionStorage).paused).toBe(true);
    rejectWrite(new Error("Connection lost"));
    await screen.findByText(/Request outcome unknown/);
    expect(create).toBeDisabled();
  });
});
