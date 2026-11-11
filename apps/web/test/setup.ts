import { beforeEach, afterEach, vi } from "vitest";
beforeEach(() => { vi.stubGlobal("fetch", () => { throw new Error("Network disabled: use recorded fixtures or explicit fetch stubs"); }); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
