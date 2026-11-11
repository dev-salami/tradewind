// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { viewFunction } from "@tradewind/core";
import { requireSession } from "../src/server/auth/session";
import { repository } from "../src/server/db";
import * as db from "../src/server/db";
import { GET } from "../src/app/ops/relayer/route";
vi.mock("@tradewind/core", async original => ({ ...await original<typeof import("@tradewind/core")>(), viewFunction: vi.fn() }));
vi.mock("../src/server/auth/session", () => ({ requireSession: vi.fn() }));
let repo: ReturnType<typeof repository>;
beforeEach(() => { repo = repository(":memory:"); vi.spyOn(db, "store").mockReturnValue(repo); vi.mocked(viewFunction).mockResolvedValue({ owner: "owner.testnet" }); vi.mocked(requireSession).mockReturnValue({ accountId: "other.testnet", exp: 1 }); });
afterEach(() => { repo.db.close(); vi.restoreAllMocks(); });
it("requires the authenticated chain owner and does not create a missing relayer table", async () => {
  expect((await GET(new Request("http://localhost/ops/relayer"))).status).toBe(403);
  vi.mocked(requireSession).mockReturnValue({ accountId: "owner.testnet", exp: 1 });
  const response = await GET(new Request("http://localhost/ops/relayer")); expect(await response.json()).toEqual({ rows: [] });
  expect(repo.db.prepare("SELECT name FROM sqlite_master WHERE name='relayer_forwards'").get()).toBeUndefined();
});
