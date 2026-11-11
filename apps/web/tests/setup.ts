import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { beforeEach, afterEach, vi } from "vitest";
import { TextEncoder, TextDecoder } from "node:util";
Object.assign(globalThis, { TextEncoder, TextDecoder });
afterEach(cleanup);
beforeEach(() => { vi.stubGlobal("fetch", () => { throw new Error("Network disabled: use recorded fixtures or explicit fetch stubs"); }); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
