import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusChip } from "../src/components/status-chip";
import { TopBanner } from "../src/components/top-banner";
import { WaterfallBars } from "../src/components/waterfall";
import { waterfallWidths } from "../src/lib/waterfall";
import type { InvoiceStatus } from "@tradewind/core";
describe("honest network labels", () => {
  it("labels sample testnet and config-derived clock", () => {
    render(<TopBanner network="testnet" secondsPerDay={10} fixtures />);
    expect(screen.getByText("Testnet sandbox")).toBeInTheDocument();
    expect(screen.getByText("Demo clock: 1 contract day = 10 s")).toBeInTheDocument();
    expect(screen.getByText("Sample data · no real transactions")).toBeInTheDocument();
  });
  it("labels mainnet and never invents a clock on error", () => {
    const { rerender } = render(<TopBanner network="mainnet" secondsPerDay={86400} />);
    expect(screen.getByText("Mainnet showcase · real funds, tiny amounts")).toBeInTheDocument();
    expect(screen.getByText("Demo clock: 1 contract day = 86400 s")).toBeInTheDocument();
    rerender(<TopBanner network="mainnet" secondsPerDay={null} />);
    expect(screen.getByText(/clock unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/= 10 s/)).not.toBeInTheDocument();
  });
});
describe("status chip semantics", () => {
  it.each([
    ["Created", "Created", "slate"], ["Verified", "Checked", "slate"], ["Rejected", "Rejected", "coral"],
    ["Accepted", "Accepted", "amber"], ["AdvancePending", "Advance pending", "amber"], ["Funded", "Awaiting payment", "amber"],
    ["PartiallyPaid", "Partially paid", "amber"], ["Repaid", "Paid", "green"], ["Defaulted", "Defaulted", "coral"], ["Cancelled", "Cancelled", "slate"],
  ] as [InvoiceStatus, string, string][])("%s maps to %s / %s", (status, label, tone) => {
    render(<StatusChip status={status} />);
    expect(screen.getByText(label)).toHaveClass(`tw-pill-${tone}`);
  });
  it("overdue overrides an open invoice", () => {
    render(<StatusChip status="PartiallyPaid" overdue />);
    expect(screen.getByText("Overdue")).toHaveClass("tw-pill-coral");
  });
});
describe("waterfall widths", () => {
  const split = { to_pool_principal: "2000000", to_pool_fee: "150000", to_protocol: "50000", to_exporter: "1800000", overpaid: "0" };
  it("accounts for all of a payment, without minimum-width distortion", () => {
    render(<WaterfallBars split={split} />);
    const widths = screen.getAllByTestId("waterfall-segment").map(node => Number(node.getAttribute("data-width")));
    expect(widths).toEqual([50, 3.75, 1.25, 45, 0]);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
    expect(screen.getByRole("img")).toHaveAccessibleName(/Pool principal \$2.000000/);
  });
  it("handles recurring ratios, held overpayment and zero payments", () => {
    const thirds = waterfallWidths({ ...split, to_pool_principal: "1", to_pool_fee: "1", to_protocol: "0", to_exporter: "0", overpaid: "1" });
    expect(thirds.reduce((a, b) => a + Math.round(b * 100), 0)).toBe(10000);
    expect(waterfallWidths({ to_pool_principal: "0", to_pool_fee: "0", to_protocol: "0", to_exporter: "0", overpaid: "0" })).toEqual([0, 0, 0, 0, 0]);
  });
});
