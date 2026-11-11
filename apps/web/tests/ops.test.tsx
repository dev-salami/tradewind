import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OpsFlows } from "../src/components/ops-flows";
const mocks = vi.hoisted(() => ({ account: null as string | null, owner: "owner.testnet", reads: vi.fn() }));
vi.mock("../src/components/wallet-provider", () => ({ useWallet: () => ({ accountId: mocks.account, callView: vi.fn() }) }));
vi.mock("../src/components/write-controls", () => ({
  ReadState: ({ error }: { error?: string }) => error ? <p>{error}</p> : null,
  WriteButton: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  useView: (method: string) => { mocks.reads(method); return { loading: false, value: method === "get_roles" ? { owner: mocks.owner } : method === "list_unattributed" ? [] : {} }; },
}));
beforeEach(() => { mocks.reads.mockClear(); mocks.account = null; });
describe("ops screen fetch gate", () => {
  it("does not mount owner controls or fetch queues for disconnected or other accounts", () => {
    const { rerender } = render(<OpsFlows />);
    expect(screen.getByText("Owner only")).toBeInTheDocument();
    mocks.account = "other.testnet"; rerender(<OpsFlows />);
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(mocks.reads.mock.calls.every(([method]) => method === "get_roles")).toBe(true);
  });
  it("mounts controls and reads the queue only for the exact owner", () => {
    mocks.account = "owner.testnet"; render(<OpsFlows />);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(mocks.reads).toHaveBeenCalledWith("list_unattributed");
  });
});
