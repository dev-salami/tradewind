import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { beforeEach, afterEach, vi } from "vitest";
import { TextEncoder, TextDecoder } from "node:util";
Object.assign(globalThis, { TextEncoder, TextDecoder });
afterEach(cleanup);
const realFetch = globalThis.fetch;
// External network is disabled; loopback stays available for local fake servers (e.g. the Telegram harness).
beforeEach(() => { vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, "http://localhost");
  if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return realFetch(input, init);
  throw new Error("Network disabled: use recorded fixtures or explicit fetch stubs");
}); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
