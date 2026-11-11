# Tradewind NEAR AI verification

Live inference needs `NEARAI_API_KEY`. Public attestation reports, the model
catalog, chain reads, and browser signature verification do **not** need that key.
Without a key Tradewind defaults to mock mode; mock recording is forbidden on mainnet.

## Trust boundaries

The server fails closed before sending invoice data unless at least one selected
model report passes every step:

| Step | What it establishes |
| --- | --- |
| `quote_dcap` | Intel TDX quote signature and DCAP certificate/collateral verification with `@phala/dcap-qvl@0.7.1` |
| `tcb_status` | TCB status is exactly `UpToDate` |
| `report_data_binds_nonce_and_signer` | Signed report data is address (20 bytes), 12 zero bytes, fresh nonce (32 bytes) |
| `signer_matches_public_key` | secp256k1 public key derives the reported Ethereum address |
| `rtmr3_replay` | Ordered dstack events reproduce the quote's RTMR3 |
| `mrconfig_matches_app_compose` | mrConfigId is `01` + SHA-256 of the exact app_compose string + 15 zero bytes |
| `nvidia_nonce_matches` | GPU evidence **nonce bound; NVIDIA NRAS verification not performed** |

The recorded events omit digests for RTMR3. Their matching convention is
`SHA384(event_type_le32 || ":" || UTF8(event) || ":" || hex_decode(event_payload))`;
extend a 48-byte zero register with `SHA384(register || digest)` for each IMR 3
event in order. A supplied nonempty digest must also match the recomputed digest.
Plain replay of the recorded empty digests does not match either fixture.

mrConfig binding is not an endorsement of the application. The pure verifier
accepts `allowedAppComposeHashes` for callers with a trusted deployment policy;
the default live integration checks binding, not a pinned application allowlist.
GPU certificate chains/NRAS verdicts and gateway attestation are not independently
verified. Only verified **model** reports may authorize the response signer.

The response must be EIP-191 signed by exactly one verified preflight model
report, with `signature_kind=provider_tee`, `signing_algo=ecdsa`, and signed text
`model_id:request_hash:response_hash`. Hashes cover the exact transmitted request
JSON and received response bytes, before any decryption or JSON normalization.
The compact attestation summary is retained in the existing serialized proof
JSON; no schema migration is necessary.

The model catalog uses `owned_by` (`nearai` or `attested 3p`) and
`is_ready !== false`, not nonexistent `metadata.verifiable`. The `openai/`
namespace is excluded, including catalog entries whose owner is `nearai`.
Catalog unavailability permits only the narrow canonical fallback list; this
does **not** bypass cryptographic attestation preflight.

## ECDSA end-to-end encryption

`NEARAI_E2EE=1` is the live default; `0` explicitly opts into TLS-only inference.
The wire format follows the NEAR AI private-inference documentation:

- Fresh client response keypair; fresh sender ephemeral keypair per message.
- ECDH with the attested uncompressed model key; HKDF-SHA256 of the shared
  x-coordinate, empty salt, info `ecdsa_encryption`, 32-byte AES key.
- AES-256-GCM with a fresh 12-byte nonce and 16-byte authentication tag.
- Hex content: uncompressed ephemeral public key (65 bytes), nonce (12),
  ciphertext, tag (16). Structured vision content is JSON-serialized before
  encryption; normal text content is UTF-8 encoded directly.
- Headers: `X-Signing-Algo: ecdsa`, `X-Client-Pub-Key` (65-byte uncompressed
  client key hex), `X-Model-Pub-Key` (64-byte attested key hex),
  `X-Encryption-Version: 2`, `x-no-aliasing: true`.
- Decrypt every response choice with the client private key using the same
  envelope and authenticated cipher. Authentication failure aborts processing.

This format is fixture-tested locally with generated model keys and tampering
tests. It has **not yet been exercised against the live gateway**; that requires
an API key. In particular, encrypted structured vision content still needs live
gateway interoperability testing. No live success is implied by local tests.

## PDFs and draft reuse

Text PDFs use the text model. If any page has no extractable text, render up to
three pages as bounded PNGs with pdfjs and native canvas, then send OpenAI-style
text and `image_url` parts to the vision model. These native packages must remain
server externals. Uploaded PDF buffers are erased in `finally`; PDF bytes and
rendered images are not persisted.

Mock mode does not perform OCR. It uses the deterministic sample parser as a
sidecar result, marks a scanned result at best `warn`, and reports
`MOCK vision — scanned PDF not read`. Empty/unknown extracted fields fail the
normal arithmetic checks, usually yielding `fail`.

Draft results are cached in the existing draft JSON (and expire with it), with a
SHA-256 key over a JSON tuple of text, shipping text, and key-sorted canonical
form fields. The later recording route reuses an unchanged draft proof without
another AI call. Changed text-invoice fields re-run inference. Changed scanned
invoice fields require a new upload (409), because discarded images cannot be
reconstructed from cached text; the new draft performs vision inference again.

## Public Verify and S3

`/api/verify/[id]` first reads `get_invoice(id).verification` from NEAR. The
contract stores model ID and request/response hashes, so the signed text is
reconstructed from those on-chain fields. The chain signature, signer, model,
and hashes override the local cache. A successful chain read with no proof is
404, **not** a cache fallback. Only an RPC failure permits `source: "db"`;
otherwise `source: "chain"` identifies the contract account in the UI.

The browser independently recovers the EIP-191 signer and compares it to the
published (on-chain when available) `signing_address`. It displays the source,
MOCK badge, and server-reported attestation steps. It does not redo DCAP in the
browser and does not claim invoice authenticity. Local attestation summaries
are shown only when their proof matches the chain signature, signer and hashes.

Mock signatures are real EIP-191 signatures from the **publicly known test key**
`PUBLIC_TEST_SIGNER_KEY`, address
`0x2c7536e3605d9c16a7a3d7b1898e529396a65c23`. Anyone can forge them. They retain
`signature_kind: "mock"`, `mock: true`, and `verified_ok: false`; the UI never
presents them as TEE results. The browser also enforces this mock address.
The contract's optional ecrecover signer allowlist is the separate S3 check;
enable/allowlist this test address only in mock/sandbox environments. This work
does not modify the contract or replace its trust policy.

## Offline fixtures and refreshing

`apps/web/test/fixtures/nearai` contains recorded public reports, nonces, the
model catalog, and DCAP collateral. Tests always pass `verify-now-secs.txt`,
never the current time. The vision collateral reuses the supplied collateral
with the vision quote's embedded PCK certificate chain (as `getCollateral`
does); using the GLM PCK chain for that quote correctly fails verification.
Tests cover both real reports, nonce/compose/event/time/signer/GPU tampering,
local E2EE and authentication failures, raster-only PDFs, draft reuse and chain
precedence. Route integration tests explicitly stub the DCAP boundary; the
separate real-report tests verify DCAP without any stubs or network.

Run the scoped offline suite:

```sh
npm test -w apps/web -- --config test/vitest.config.ts
```

The existing default Vitest config includes only `tests/**`; the new suite is
under the requested `test/**` allowlist. Legacy tests asserting metadata gating,
unsigned preflight acceptance, and scanned-PDF rejection need updating when that
test directory is in scope.

Refresh public reports without an API key:

```sh
nonce=$(openssl rand -hex 32)
printf '%s\n' "$nonce" > report-z-ai_glm-5.3-flash.json.nonce
curl --fail --get 'https://cloud-api.near.ai/v1/attestation/report' \
  -H 'x-no-aliasing: true' \
  --data-urlencode 'model=z-ai/glm-5.3-flash' \
  --data-urlencode 'provider=near' \
  --data-urlencode 'signing_algo=ecdsa' \
  --data-urlencode "nonce=$nonce" \
  -o report-z-ai_glm-5.3-flash.json
curl --fail 'https://cloud-api.near.ai/v1/models' -o models.json
```

Repeat for `Qwen/Qwen3-VL-30B-A3B-Instruct`, saving its report and nonce separately.
For **each** quote, call `getCollateral(PHALA_PCCS_URL, quoteBytes)` and save the
returned JSON plus the verification timestamp in seconds. Confirm `UpToDate`
before updating fixtures. Refreshes are manual network operations, never tests.
Keep keys, authorization headers, invoice uploads and private completion data
out of fixtures and logs.
