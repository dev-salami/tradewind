import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AreaLine } from "../src/components/charts";
it("renders no activity honestly", () => {
  const html = renderToStaticMarkup(<AreaLine labels={[]} values={[]} format={String} />);
  expect(html).toContain("No pool activity yet"); expect(html).not.toContain("<svg");
});
it("renders a single point and value without an invalid line or area", () => {
  const html = renderToStaticMarkup(<AreaLine labels={["Block 42"]} values={[1000000]} format={String} />);
  expect(html).toContain("<circle"); expect(html).toContain("1000000"); expect(html).not.toContain("<path");
  expect(html).not.toMatch(/NaN|Infinity/);
});
it("renders a line for multiple real points", () => {
  const html = renderToStaticMarkup(<AreaLine labels={["Block 42", "Block 45", "Block 49"]} values={[1000000, 1000100, 999900]} format={String} />);
  expect(html.match(/<path/g)).toHaveLength(2); expect(html).not.toMatch(/NaN|Infinity/);
});
