import { verify } from "@phala/dcap-qvl";
import { sha256 } from "@noble/hashes/sha256";
import { sha384 } from "@noble/hashes/sha512";
import { bytesToHex, hexToBytes, concatBytes } from "@noble/hashes/utils";
import { publicKeyToAddress } from "viem/accounts";

export interface ModelAttestation {
  intel_quote: string; signing_address: string; signing_public_key: string; signing_algo: string; request_nonce: string;
  event_log: { imr: number; digest: string; event_type: number; event: string; event_payload: string }[];
  info: { tcb_info: { app_compose: string } }; nvidia_payload: string | { nonce: string };
}
export interface AttestationStep { id: string; ok: boolean; detail: string }
export async function verifyModelAttestation(att: ModelAttestation, options: {
  nonce: string; collateral: Parameters<typeof verify>[1]; nowSecs: number; allowedAppComposeHashes?: string[];
}) {
  const steps: AttestationStep[] = [];
  let tcbStatus = "", mrTdPrefix = "";
  const step = async (id: string, check: () => boolean | Promise<boolean>, detail: string) => {
    try { steps.push({ id, ok: await check(), detail }); }
    catch { steps.push({ id, ok: false, detail: `${detail} (invalid evidence)` }); }
  };
  let verified: Awaited<ReturnType<typeof verify>> | undefined;
  await step("quote_dcap", async () => {
    if (!Number.isSafeInteger(options.nowSecs) || options.nowSecs < 0) return false;
    verified = await verify(hexToBytes(att.intel_quote.replace(/^0x/, "")), options.collateral, options.nowSecs);
    return verified.report.type === "td10";
  }, "Intel TDX/DCAP quote verification");
  const data = verified?.report.asTd10();
  await step("tcb_status", () => { tcbStatus = verified?.status ?? ""; return tcbStatus === "UpToDate"; }, "TCB must be UpToDate");
  await step("report_data_binds_nonce_and_signer", () => {
    if (!/^[a-f0-9]{64}$/i.test(options.nonce) || !/^0x[a-f0-9]{40}$/i.test(att.signing_address)) return false;
    return att.request_nonce === options.nonce && !!data && bytesToHex(data.reportData) === `${att.signing_address.slice(2).toLowerCase()}${"00".repeat(12)}${options.nonce.toLowerCase()}`;
  }, "Quote binds request nonce and signing address");
  await step("signer_matches_public_key", () => att.signing_algo === "ecdsa" && /^[a-f0-9]{128}$/i.test(att.signing_public_key) && publicKeyToAddress(`0x04${att.signing_public_key}`).toLowerCase() === att.signing_address.toLowerCase(), "ECDSA public key matches signing address");
  await step("rtmr3_replay", () => {
    let rtmr: Uint8Array = new Uint8Array(48);
    for (const event of att.event_log.filter(e => e.imr === 3)) {
      const type = new Uint8Array(4);
      new DataView(type.buffer).setUint32(0, event.event_type, true);
      const digest = sha384(concatBytes(type, new TextEncoder().encode(`:${event.event}:`), hexToBytes(event.event_payload)));
      if (event.digest && event.digest.toLowerCase() !== bytesToHex(digest)) return false;
      rtmr = sha384(concatBytes(rtmr, digest));
    }
    return !!data && bytesToHex(rtmr) === bytesToHex(data.rtMr3);
  }, "RTMR3 replay using dstack SHA-384 event digests (hex-decoded payload)");
  await step("mrconfig_matches_app_compose", () => {
    if (typeof att.info.tcb_info.app_compose !== "string") return false;
    const hash = bytesToHex(sha256(new TextEncoder().encode(att.info.tcb_info.app_compose)));
    return !!data && bytesToHex(data.mrConfigId) === `01${hash}${"00".repeat(15)}` && (!options.allowedAppComposeHashes || options.allowedAppComposeHashes.includes(hash));
  }, "mrConfigId binds app_compose SHA-256 (not an application allowlist unless configured)");
  await step("nvidia_nonce_matches", () => (typeof att.nvidia_payload === "string" ? JSON.parse(att.nvidia_payload) : att.nvidia_payload).nonce === options.nonce, "GPU evidence nonce bound; NVIDIA NRAS verification not performed");
  if (data) mrTdPrefix = bytesToHex(data.mrTd).slice(0, 16);
  return { ok: steps.every(s => s.ok), steps, signingAddress: att?.signing_address ?? "", tcbStatus, mrTdPrefix };
}
