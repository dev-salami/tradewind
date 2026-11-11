// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Quote } from "@phala/dcap-qvl";
import { verifyModelAttestation, type ModelAttestation } from "../src/lib/attestation/verify-report";
import { isVerifiableModel, type CatalogModel } from "../src/server/nearai/models";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/nearai/${name}`, import.meta.url), "utf8");
const collateral = JSON.parse(fixture("collateral-glm.json"));
const nowSecs = Number(fixture("verify-now-secs.txt"));
afterEach(() => vi.unstubAllGlobals());
for (const name of ["z-ai_glm-5.3-flash", "Qwen_Qwen3-VL-30B-A3B-Instruct"]) {
  const filename = `report-${name}.json`;
  const att: ModelAttestation = JSON.parse(fixture(filename)).model_attestations[0];
  const options = { nonce: fixture(`${filename}.nonce`).trim(), collateral: name.startsWith("Qwen") ? JSON.parse(fixture("collateral-vision.json")) : collateral, nowSecs };
  it(`${name}: real DCAP, nonce/signer binding, RTMR3, mrConfig and GPU nonce`, async () => {
    vi.stubGlobal("fetch", () => { throw new Error("Tests must not access the network"); });
    const result = await verifyModelAttestation(att, options);
    expect(result.steps).toHaveLength(7);
    expect(result.steps.filter(s => !s.ok)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.tcbStatus).toBe("UpToDate");
    const report = Quote.parse(Buffer.from(att.intel_quote, "hex")).report.asTd10()!;
    expect(Buffer.from(report.reportData).toString("hex")).toBe(`${att.signing_address.slice(2)}${"00".repeat(12)}${options.nonce}`);
    const composeHash = createHash("sha256").update(att.info.tcb_info.app_compose).digest("hex");
    expect(Buffer.from(report.mrConfigId).toString("hex")).toBe(`01${composeHash}${"00".repeat(15)}`);
    if (name.startsWith("z-ai")) expect(composeHash.startsWith("a0e3c6f4")).toBe(true);
    let plain = Buffer.alloc(48);
    for (const event of att.event_log.filter(e => e.imr === 3)) plain = createHash("sha384").update(Buffer.concat([plain, Buffer.from(event.digest, "hex")])).digest();
    expect(plain.equals(Buffer.from(report.rtMr3))).toBe(false);
  });
  it.each(["nonce", "compose", "event", "time", "signer", "gpu"])(`${name}: rejects tampered %s at the right step`, async kind => {
    const changed = structuredClone(att), opts = { ...options };
    let failed = "";
    if (kind === "nonce") { opts.nonce = `${opts.nonce[0] === "0" ? "1" : "0"}${opts.nonce.slice(1)}`; failed = "report_data_binds_nonce_and_signer"; }
    if (kind === "compose") { changed.info.tcb_info.app_compose += " "; failed = "mrconfig_matches_app_compose"; }
    if (kind === "event") { changed.event_log.splice(changed.event_log.findIndex(e => e.imr === 3), 1); failed = "rtmr3_replay"; }
    if (kind === "time") { opts.nowSecs = 0; failed = "quote_dcap"; }
    if (kind === "signer") { changed.signing_public_key = "00".repeat(64); failed = "signer_matches_public_key"; }
    if (kind === "gpu") { changed.nvidia_payload = { nonce: "wrong" }; failed = "nvidia_nonce_matches"; }
    const result = await verifyModelAttestation(changed, opts);
    expect(result.ok).toBe(false);
    expect(result.steps.find(s => s.id === failed)?.ok).toBe(false);
  });
}
it("real model catalog uses owner and readiness, not metadata.verifiable", () => {
  const models: CatalogModel[] = JSON.parse(fixture("models.json")).data;
  for (const id of ["z-ai/glm-5.3-flash", "Qwen/Qwen3-VL-30B-A3B-Instruct"]) expect(isVerifiableModel(models.find(m => m.id === id)!)).toBe(true);
  expect(isVerifiableModel(models.find(m => m.id === "deepseek/deepseek-v3.2")!)).toBe(false);
  expect(models.filter(m => m.id.startsWith("openai/")).every(m => !isVerifiableModel(m))).toBe(true);
});
it("malformed evidence fails closed without throwing", async () => {
  const result = await verifyModelAttestation(null as unknown as ModelAttestation, { nonce: "00".repeat(32), collateral, nowSecs });
  expect(result.ok).toBe(false);
  expect(result.steps).toHaveLength(7);
  expect(result.steps.every(s => !s.ok)).toBe(true);
});
