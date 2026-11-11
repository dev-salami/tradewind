import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OpsConsole } from "../src/app/ops/console";
import { AppShell } from "../src/components/chrome";
import { editableKeys, settingsPreview, settingsTx } from "../src/app/ops/settings-model";

const mocks = vi.hoisted(() => ({ allowed: false, config: { min_payment: "1000000", base_buyer_limit: "10000000", seconds_per_day: 10, grace_days: 7, default_after_days: 30 }, sign: vi.fn(), view: vi.fn(), retry: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/ops" }));
vi.mock("../src/app/ops/access", () => ({ useOwnerAccess: () => ({ allowed: mocks.allowed, refresh: vi.fn() }) }));
vi.mock("../src/components/guided-mode", () => ({ GuidedNavLink: () => null }));
vi.mock("../src/components/ops-flows", () => ({ OpsFlows: () => <p>Existing operations panels</p> }));
vi.mock("../src/components/wallet-provider", () => ({ WalletMenu: () => null, useWallet: () => ({ accountId: "owner.testnet", signInSession: vi.fn(), callView: mocks.view, signAndSend: mocks.sign }) }));
vi.mock("../src/components/write-controls", async importOriginal => ({
  ...await importOriginal<typeof import("../src/components/write-controls")>(),
  useView: () => ({ loading: false, value: mocks.config, retry: mocks.retry }),
}));
beforeEach(() => {
  mocks.allowed = true; mocks.sign.mockReset(); mocks.view.mockReset(); mocks.view.mockResolvedValue(mocks.config);
  vi.stubEnv("NEXT_PUBLIC_DATA_SOURCE", "rpc"); vi.stubEnv("NEXT_PUBLIC_NEAR_NETWORK", "testnet"); vi.stubEnv("NEXT_PUBLIC_CORE_CONTRACT_ID", "core.testnet");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ isOwner: true })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function preview() {
  fireEvent.change(screen.getByLabelText("New value (USDC)"), { target: { value: "2.5" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview diff" }));
}
describe("owner settings", () => {
  it("hides Ops navigation and all forms for non-owners", () => {
    mocks.allowed = false;
    const { rerender } = render(<AppShell network="testnet"><OpsConsole /></AppShell>);
    expect(screen.queryByRole("link", { name: "Ops" })).not.toBeInTheDocument();
    expect(screen.getByText("403 · Owner access only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview diff" })).not.toBeInTheDocument();
    mocks.allowed = true; rerender(<AppShell network="testnet"><OpsConsole /></AppShell>);
    expect(screen.getByRole("link", { name: "Ops" })).toBeInTheDocument();
    expect(screen.getByText("Existing operations panels")).toBeInTheDocument();
  });
  it("previews exact base-unit changes and only signs after an explicit action", async () => {
    render(<OpsConsole />); preview();
    expect(screen.getByText("min_payment: 1000000 → 2500000")).toBeInTheDocument();
    expect(mocks.sign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sign configuration change" }));
    await waitFor(() => expect(mocks.sign).toHaveBeenCalledWith(settingsTx("core.testnet", { ...mocks.config, min_payment: "2500000" })));
  });
  it("requires an extra mainnet confirmation and clears it on edits", () => {
    vi.stubEnv("NEXT_PUBLIC_NEAR_NETWORK", "mainnet");
    render(<OpsConsole />); preview();
    expect(screen.getByRole("button", { name: "Sign configuration change" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand this changes mainnet configuration." }));
    expect(screen.getByRole("button", { name: "Sign configuration change" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("New value (USDC)"), { target: { value: "3" } });
    expect(screen.queryByLabelText("Configuration diff")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview diff" }));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
  it("refuses stale configuration and expired owner sessions before wallet signing", async () => {
    mocks.view.mockResolvedValue({ ...mocks.config, base_buyer_limit: "20000000" });
    render(<OpsConsole />); preview();
    fireEvent.click(screen.getByRole("button", { name: "Sign configuration change" }));
    await screen.findByText("Configuration changed. Review a fresh diff before signing.");
    expect(mocks.sign).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValue(Response.json({ isOwner: false }));
    preview(); fireEvent.click(screen.getByRole("button", { name: "Sign configuration change" }));
    await screen.findByText("Owner session expired. Sign in again before changing settings.");
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("restricts editable keys and checks amounts, no-ops and sandbox clock overflow", () => {
    expect(editableKeys("mainnet")).toEqual(["min_payment", "base_buyer_limit"]);
    expect(editableKeys("sandbox")).toContain("seconds_per_day");
    expect(() => settingsPreview(mocks.config, "seconds_per_day", "5", "testnet")).toThrow("not editable");
    expect(() => settingsPreview(mocks.config, "min_payment", "0", "testnet")).toThrow();
    expect(() => settingsPreview(mocks.config, "min_payment", "1", "testnet")).toThrow("No change");
    expect(() => settingsPreview({ ...mocks.config, invoice_counter_start: Number.MAX_SAFE_INTEGER + 1 }, "min_payment", "2", "testnet")).toThrow("unsafe JSON integer");
    expect(() => settingsPreview(mocks.config, "seconds_per_day", "4294967295", "sandbox")).toThrow("overflow");
    expect(settingsPreview(mocks.config, "seconds_per_day", "20", "sandbox").after).toBe(20);
    const original = { ...mocks.config };
    const diff = settingsPreview(original, "min_payment", "2", "testnet");
    original.base_buyer_limit = "999";
    expect(diff.original.base_buyer_limit).toBe("10000000");
    expect(diff.config.base_buyer_limit).toBe("10000000");
  });
});
