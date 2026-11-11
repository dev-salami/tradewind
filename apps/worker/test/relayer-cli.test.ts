import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it.each(["https://rpc.mainnet.near.org", "https://rpc.testnet.near.org", "http://localhost.invalid:3039", "http://127.0.0.1:3039@rpc.mainnet.near.org"])("sandbox runner refuses %s before reading keys or making RPC calls", async rpc => {
  const dir = mkdtempSync(join(tmpdir(), "relayer-cli-")), env = join(dir, "local.env");
  try {
    writeFileSync(env, `NEAR_NETWORK=sandbox\nNEAR_RPC_URL=${rpc}\n`);
    await expect(promisify(execFile)(process.execPath, [resolve("../../scripts/e2e-relayer.mjs"), join(dir, "missing-validator-home"), env])).rejects.toMatchObject({ stderr: expect.stringContaining("Refusing non-local sandbox RPC") });
  } finally { rmSync(env); rmdirSync(dir); }
});
