/**
 * @file scripts/issuer-verifier.interop.test.ts
 *
 * UniDipVeri End-to-End Interoperability & Institutional Policy Test Suite.
 *
 * 3-PARTY ARCHITECTURE & ACTOR ROLES:
 * -----------------------------------
 * This test suite verifies the end-to-end cryptographic and protocol interoperability
 * of the UniDipVeri SD-JWT Verifiable Credential system against an external, production-grade
 * third-party verifier across the open SSI trust triangle:
 *
 * 1. ISSUER (UniDipVeri):
 *    - Implements OpenID4VCI 1.0 Final (with legacy OID4VCI fallback).
 *    - Issues SD-JWT VCs conforming to draft-ietf-oauth-sd-jwt-vc-19 (typ: "dc+sd-jwt").
 *    - Publishes W3C DID document (did:web) over public HTTPS via Cloudflare Quick Tunnel,
 *      providing a clean Web PKI TLS certificate (Google Trust Services / Let's Encrypt)
 *      without custom ports or local CA injection.
 *    - Serves Token Status List revocation documents (draft-ietf-oauth-status-list-21)
 *      as application/statuslist+jwt with gzip bitstring compression.
 *
 * 2. HOLDER / DIGITAL WALLET (Automated by this test script):
 *    - In the Verifiable Credentials architecture, the Holder (wallet) mediates between
 *      the Issuer and the Verifier. The test code automates the Holder's responsibilities:
 *      a. Obtains credential from Issuer via OID4VCI (generating holder key pair and proof of possession).
 *      b. Receives OID4VP authorization request and DCQL query from the external Verifier.
 *      c. Derives selective disclosure presentations by filtering disclosures according to
 *         the verifier's query and policy requirements (e.g. revealing only requested fields).
 *      d. Computes the presentation string per RFC 9901: <Issuer-JWT>~<Disclosure 1>~...~<Disclosure N>~[<KB-JWT>].
 *      e. Signs an ephemeral Key Binding JWT (kb+jwt) using the holder private key (cnf.jwk)
 *         over the exact presented string (sd_hash) bound to the verifier's client_id and nonce.
 *      f. Submits the presentation response (vp_token) to the Verifier's response endpoint.
 *
 * 3. VERIFIER (Walt.id Verifier 2 Container):
 *    - Pinned Container Image: docker.io/waltid/verifier-api2:1.2.0@sha256:2e8581019531c2efa17a2c086b9c76ee7fee4bb5ee68369e2ea1864733039e9a
 *    - An independent, third-party OpenID4VP 1.0 Final verifier supporting DCQL and vc-policies.
 *    - Resolves the Issuer's did:web over standard public HTTPS (port 443) to dereference public keys.
 *    - Resolves the Issuer's Token Status List over public HTTPS to verify real-time revocation.
 *    - Validates disclosure digests, holder Key Binding JWT, and institutional verification policies.
 */

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import * as jose from "../apps/issuer/node_modules/jose";
import { loadSchemaFromFile } from "../packages/core/src/schema/loader.js";
import { loadIssuerConfig } from "../apps/issuer/src/config.js";
import { initializeKeyManager } from "../apps/issuer/src/services/key-manager.js";
import { SessionManager } from "../apps/issuer/src/services/session-manager.js";
import { StudentRecordService } from "../apps/issuer/src/services/student-records.js";
import { StatusListService } from "../apps/issuer/src/services/status-list.js";
import { createApp } from "../apps/issuer/src/app.js";
import { decodeDisclosure } from "../packages/core/src/sd-jwt/disclosure.js";

/** Pinned Walt.id Verifier 2 Container Image and Content Digest */
export const WALTID_IMAGE = "docker.io/waltid/verifier-api2:1.2.0@sha256:2e8581019531c2efa17a2c086b9c76ee7fee4bb5ee68369e2ea1864733039e9a";

interface VerificationSessionResponse {
  sessionId: string;
  authorizationRequestUrl: string;
}

interface VerificationSessionInfo {
  id: string;
  status: string;
  authorizationRequest: {
    client_id: string;
    nonce: string;
    state: string;
    response_uri: string;
    dcql_query: unknown;
  };
  policies?: unknown;
  verificationResult?: unknown;
  failure?: unknown;
  policyResults?: unknown;
  data?: {
    disclosures?: Array<{
      name?: string;
      value?: unknown;
      location?: string[];
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface DidDocumentResult {
  id: string;
  [key: string]: unknown;
}

interface OfferResponseData {
  credential_offer: {
    grants: {
      "urn:ietf:params:oauth:grant-type:pre-authorized_code": {
        "pre-authorized_code": string;
      };
    };
  };
}

interface TokenResponseData {
  access_token: string;
  c_nonce: string;
  [key: string]: unknown;
}

interface TunnelHandle {
  tunnelUrl: string;
  domain: string;
  stop: () => void;
}

/**
 * Discovers available container runtime CLI (docker or podman).
 * Prioritizes docker (standard on CI and podman-docker CLI emulation).
 */
export function findContainerCli(): string {
  if (process.env.WALTID_CONTAINER_CLI) {
    return process.env.WALTID_CONTAINER_CLI;
  }
  const dockerCheck = Bun.spawnSync(["docker", "--version"]);
  if (dockerCheck.exitCode === 0) {
    return "docker";
  }
  const podmanCheck = Bun.spawnSync(["podman", "--version"]);
  if (podmanCheck.exitCode === 0) {
    return "podman";
  }
  return "docker";
}

/**
 * Ensures the third-party Walt.id Verifier container is healthy and responding.
 * If not already responding, inspects and starts or spawns the pinned container image.
 */
export async function ensureVerifierContainerRunning(
  waltidBase: string,
  containerName: string = "test-waltid-verifier"
): Promise<void> {
  try {
    const livez = await fetch(`${waltidBase}/livez`);
    if (livez.ok) {
      console.log(`✓ Walt.id Verifier is active on ${waltidBase}`);
      return;
    }
  } catch {
    // Verifier is not currently responding, attempt container start
  }

  console.log(`Walt.id Verifier not responding at ${waltidBase}. Checking container '${containerName}'...`);
  const cli = findContainerCli();

  const inspectRes = Bun.spawnSync([cli, "inspect", containerName]);
  if (inspectRes.exitCode === 0) {
    console.log(`Container '${containerName}' exists. Starting it via ${cli}...`);
    Bun.spawnSync([cli, "start", containerName]);
  } else {
    console.log(`Spawning fresh container '${containerName}' via ${cli}...`);
    const runRes = Bun.spawnSync([
      cli,
      "run",
      "-d",
      "--name",
      containerName,
      "--net=host",
      WALTID_IMAGE,
    ]);
    if (runRes.exitCode !== 0) {
      const err = new TextDecoder().decode(runRes.stderr);
      console.warn(`Notice: ${cli} run exited with code ${runRes.exitCode}: ${err.trim()}`);
    }
  }

  console.log(`Waiting for Walt.id Verifier readiness at ${waltidBase}/livez...`);
  for (let i = 0; i < 40; i++) {
    try {
      const livez = await fetch(`${waltidBase}/livez`);
      if (livez.ok) {
        console.log(`✓ Walt.id Verifier is active on ${waltidBase}`);
        return;
      }
    } catch {
      // Continue polling until ready
    }
    await Bun.sleep(1000);
  }

  throw new Error(`Walt.id Verifier failed to become ready at ${waltidBase} within 40 seconds`);
}

/**
 * Restarts the verifier container to flush its in-memory status list and metadata HTTP cache.
 * Walt.id verifier caches resolved status lists in memory; restarting forces a fresh fetch
 * to verify real-time revocation.
 */
export function restartVerifierContainer(containerName: string = "test-waltid-verifier"): void {
  console.log(`Restarting verifier container '${containerName}' to flush in-memory HTTP cache...`);
  const cli = findContainerCli();
  const res = Bun.spawnSync([cli, "restart", containerName]);
  if (res.exitCode !== 0) {
    const fallbackCli = cli === "docker" ? "podman" : "docker";
    Bun.spawnSync([fallbackCli, "restart", containerName]);
  }
}

/**
 * Starts a Cloudflare Quick Tunnel (or uses preconfigured ISSUER_BASE_URL),
 * providing a public HTTPS URL with official Web PKI certificate (no port in did:web).
 * This eliminates the need for any local self-signed certificates or container truststore imports,
 * allowing standard third-party verifiers to dereference did:web and status lists seamlessly.
 */
async function startCloudflareTunnel(localPort: number): Promise<TunnelHandle> {
  if (process.env.ISSUER_BASE_URL) {
    const tunnelUrl = process.env.ISSUER_BASE_URL.replace(/\/+$/, "");
    const domain = tunnelUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    console.log(`Using preconfigured tunnel URL: ${tunnelUrl} (domain: ${domain})`);
    return {
      tunnelUrl,
      domain,
      stop: () => {},
    };
  }

  const cloudflaredCheck = Bun.spawnSync(["which", "cloudflared"]);
  if (cloudflaredCheck.exitCode !== 0) {
    throw new Error(
      "cloudflared executable not found in PATH. Please ensure cloudflared is installed or run inside devenv."
    );
  }

  console.log(`Spawning Cloudflare Quick Tunnel targeting http://127.0.0.1:${localPort}...`);
  const proc = Bun.spawn(
    ["cloudflared", "tunnel", "--url", `http://127.0.0.1:${localPort}`],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  let tunnelUrl: string | undefined;

  async function monitorStream(readable: ReadableStream<Uint8Array>) {
    const reader = readable.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);
        const match = buffer.match(/https:\/\/[-a-zA-Z0-9.]+\.trycloudflare\.com/);
        if (match && !tunnelUrl) {
          tunnelUrl = match[0];
        }
      }
    } catch {
      // stream ended
    }
  }

  monitorStream(proc.stderr);
  monitorStream(proc.stdout);

  for (let i = 0; i < 40; i++) {
    if (tunnelUrl) break;
    await Bun.sleep(500);
  }

  if (!tunnelUrl) {
    proc.kill();
    throw new Error("Failed to obtain Cloudflare Quick Tunnel URL within 20s");
  }

  const domain = tunnelUrl.replace("https://", "").replace(/\/+$/, "");
  console.log(`✓ Cloudflare Tunnel established: ${tunnelUrl}`);
  console.log(`✓ Resolved Issuer DID: did:web:${domain} (clean Web PKI, NO PORT in did:web)`);

  // Wait for Cloudflare Anycast DNS propagation to prevent premature NXDOMAIN negative caching on host resolver
  console.log("Waiting 8s for Cloudflare Anycast DNS propagation before initial query...");
  await Bun.sleep(8000);

  // Await public edge DNS / routing propagation using strict TLS fetch
  console.log("Awaiting Cloudflare Edge routing readiness (strict TLS)...");
  let edgeReady = false;
  for (let i = 1; i <= 20; i++) {
    try {
      const res = await fetch(tunnelUrl);
      if (res.status >= 200 && res.status < 600) {
        edgeReady = true;
        break;
      }
    } catch {
      // DNS or edge routing still propagating
    }
    await Bun.sleep(1500);
  }

  if (edgeReady) {
    console.log("✓ Cloudflare Edge is online and responding over publicly trusted HTTPS");
  } else {
    console.warn("⚠️ Warning: Edge did not respond in 40s, continuing with suite...");
  }

  return {
    tunnelUrl,
    domain,
    stop: () => {
      try {
        proc.kill();
      } catch {}
    },
  };
}

/**
 * Options for running a complete OID4VP presentation verification scenario.
 */
interface VerificationScenarioOptions {
  scenarioName: string;
  waltidBase: string;
  vctUrl: string;
  claims: Array<{ path: string[]; id?: string }>;
  claimSets?: string[][];
  policies: Array<{ policy: string; argument?: unknown; [key: string]: unknown }>;
  disclosuresToInclude: string[];
  issuerJwtPart: string;
  holderKeyPair: jose.GenerateKeyPairResult;
  expectedStatus?: "SUCCESSFUL" | "FAILED";
  evidenceFile?: string;
}

/**
 * Executes a full OpenID4VP presentation and verification cycle against the Walt.id Verifier.
 *
 * HOW THE TEST ACTS AS THE HOLDER / DIGITAL WALLET:
 * -------------------------------------------------
 * In this function, the test runner acts as the Holder / Wallet interacting with the Verifier:
 * 1. [Verifier] Initiates an OID4VP authorization session with a DCQL query specifying requested
 *    claims and verification policies (e.g., signature verification, regex constraints, status list checks).
 * 2. [Holder] Reads the verifier's authorization request parameters:
 *    - client_id: The verifier's relying party identifier.
 *    - nonce: A cryptographic challenge from the verifier to guarantee presentation freshness.
 *    - state: The verifier session state.
 * 3. [Holder] Constructs the SD-JWT presentation wire format according to RFC 9901:
 *    - Combines the issuer-signed JWT with ONLY the disclosures selected by the holder policy.
 *    - Wire format: `<Issuer-signed JWT>~<Disclosure 1>~...~<Disclosure N>~`
 *    - Calculates `sd_hash` (SHA-256 digest of the US-ASCII bytes of the presentation string up to trailing tilde).
 *    - Signs an ephemeral Holder Key Binding JWT (`typ: "kb+jwt"`) containing `aud` (verifier client_id),
 *      `nonce` (verifier challenge), and `sd_hash`. This binds the presentation string to the verifier's session
 *      and proves the holder controls the private key corresponding to `cnf.jwk` in the credential payload.
 *    - Appends the Key Binding JWT to finalize the full presentation string.
 * 4. [Holder] Submits the presentation response (`vp_token`) to the verifier's response endpoint.
 * 5. [Verifier Audit] Fetches the completed session information, checking policy evaluation results
 *    and inspecting reconstructed claims vs concealed claims.
 * 6. [Evidence Capture] Saves the raw verifier JSON response to disk for telemetry and verification proof.
 */
async function runVerificationScenario(options: VerificationScenarioOptions): Promise<{
  sessionInfo: VerificationSessionInfo;
  responseStatus: number;
  responseText: string;
}> {
  console.log(`\n--- Running Scenario: ${options.scenarioName} ---`);

  // 1. [Verifier]: Create verification session on Walt.id with DCQL query and vc_policies
  const sessionRes = await fetch(`${options.waltidBase}/verification-session/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      flow_type: "cross_device",
      core_flow: {
        dcql_query: {
          credentials: [
            {
              id: "graduation_cred",
              format: "dc+sd-jwt",
              meta: {
                vct_values: [options.vctUrl],
              },
              claims: options.claims,
              ...(options.claimSets ? { claim_sets: options.claimSets } : {}),
            },
          ],
        },
        policies: {
          vc_policies: options.policies,
        },
      },
    }),
  });

  if (!sessionRes.ok) {
    throw new Error(`Session creation failed: HTTP ${sessionRes.status} ${await sessionRes.text()}`);
  }
  const sessionData = (await sessionRes.json()) as VerificationSessionResponse;
  const sessionId = sessionData.sessionId;

  // 2. [Holder]: Fetch session parameters (client_id, nonce, state) from the verifier
  const infoRes = await fetch(`${options.waltidBase}/verification-session/${sessionId}/info`);
  const sessionInfo = (await infoRes.json()) as VerificationSessionInfo;
  const authReq = sessionInfo.authorizationRequest;

  // 3. [Holder]: Assemble SD-JWT presentation and sign Key Binding JWT
  // RFC 9901 wire format: <Issuer-signed JWT>~<Disclosure 1>~...~<Disclosure N>~[<KB-JWT>]
  const sdJwtPresentationString = options.disclosuresToInclude.length > 0
    ? `${options.issuerJwtPart}~${options.disclosuresToInclude.join("~")}~`
    : `${options.issuerJwtPart}~`;

  // Compute sd_hash over US-ASCII bytes of the presentation string up to trailing tilde
  const encoder = new TextEncoder();
  const sdHashBytes = await crypto.subtle.digest("SHA-256", encoder.encode(sdJwtPresentationString));
  const sdHash = jose.base64url.encode(new Uint8Array(sdHashBytes));

  // Construct Holder Key Binding JWT proving possession of cnf.jwk and binding to verifier session
  const kbJwt = await new jose.SignJWT({
    aud: authReq.client_id,
    nonce: authReq.nonce,
    iat: Math.floor(Date.now() / 1000),
    sd_hash: sdHash,
  })
    .setProtectedHeader({
      alg: "ES256",
      typ: "kb+jwt",
    })
    .sign(options.holderKeyPair.privateKey);

  const fullPresentation = `${sdJwtPresentationString}${kbJwt}`;

  // 4. [Holder]: Submit presentation response (vp_token) to verifier response_uri
  const postBody = new URLSearchParams();
  postBody.set("state", authReq.state);
  postBody.set("vp_token", JSON.stringify({ graduation_cred: [fullPresentation] }));

  const submitRes = await fetch(`${options.waltidBase}/verification-session/${sessionId}/response`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: postBody.toString(),
  });

  const responseText = await submitRes.text();
  console.log(`Response HTTP ${submitRes.status}:`, responseText);

  // 5. [Verifier Audit]: Fetch final verification status and policy evaluation results
  const finalInfoRes = await fetch(`${options.waltidBase}/verification-session/${sessionId}/info`);
  const finalInfo = (await finalInfoRes.json()) as VerificationSessionInfo;
  console.log(`Final Status: ${finalInfo.status}${options.expectedStatus ? ` (Expected: ${options.expectedStatus})` : ""}`);

  // 6. [Evidence Capture]: Save raw verifier JSON response as persistent evidence
  if (options.evidenceFile) {
    const evidenceDir = join(import.meta.dir, "../docs/interop/evidence");
    mkdirSync(evidenceDir, { recursive: true });
    const evidencePath = join(evidenceDir, options.evidenceFile);
    await Bun.write(evidencePath, JSON.stringify(finalInfo, null, 2) + "\n");
    console.log(`  [Saved Evidence] -> ${evidencePath}`);
  }

  return {
    sessionInfo: finalInfo,
    responseStatus: submitRes.status,
    responseText,
  };
}

async function main() {
  console.log("=== UniDipVeri -> Walt.id Verifier Interoperability & Policy Test Suite ===");
  console.log("Pinned Verifier Image:", WALTID_IMAGE);

  const WALTID_BASE = process.env.WALTID_BASE || "http://localhost:7004";
  const CONTAINER_NAME = process.env.WALTID_CONTAINER_NAME || "test-waltid-verifier";

  // 1. Ensure Walt.id Verifier container is ready
  await ensureVerifierContainerRunning(WALTID_BASE, CONTAINER_NAME);

  // 2. Start Cloudflare Tunnel (or use pre-configured tunnel)
  const tunnel = await startCloudflareTunnel(3000);
  const { tunnelUrl, domain } = tunnel;

  console.log(`\nStarting UniDipVeri Issuer bound to public HTTPS (${tunnelUrl}, Variant A: did:web)...`);
  const runtimeIssuerKeyPair = await jose.generateKeyPair("ES256", { extractable: true });
  const runtimeIssuerJwk = await jose.exportJWK(runtimeIssuerKeyPair.privateKey);
  runtimeIssuerJwk.kid = "issuer-key-1";
  const issuerPrivKeyJson = JSON.stringify(runtimeIssuerJwk);

  const config = loadIssuerConfig({
    PORT: "3000",
    ISSUER_BASE_URL: tunnelUrl,
    ISSUER_DID: `did:web:${domain}`,
    VCT_BASE_URL: tunnelUrl,
    SIGNING_ALGORITHM: "ES256",
    KEY_ID: "issuer-key-1",
    ISSUER_PRIVATE_KEY_JWK: issuerPrivKeyJson,
    ENABLE_LEGACY_VC_FORMAT: "true",
  });

  const schemaConfig = await loadSchemaFromFile(config.schemaPath);
  const keyContext = await initializeKeyManager(config);
  const sessionManager = new SessionManager();
  const studentRecordsService = new StudentRecordService();
  const statusListService = new StatusListService();

  const app = createApp(
    config,
    keyContext,
    schemaConfig,
    sessionManager,
    studentRecordsService,
    statusListService
  );

  const server = Bun.serve({
    port: 3000,
    fetch: app,
  });
  console.log(`✓ Issuer local HTTP listener running on http://127.0.0.1:3000 (proxied via ${tunnelUrl})`);

  let isCleanedUp = false;
  const cleanup = async () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    try {
      await server.stop(true);
      console.log("\n✓ Issuer server stopped");
    } catch {}
    try {
      tunnel.stop();
      console.log("✓ Cloudflare Tunnel stopped");
    } catch {}
  };

  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", async () => {
    await cleanup();
    process.exit(143);
  });

  try {
    // 3. Verify DID Document resolution over public HTTPS (standard Web PKI certificate)
    const didDocRes = await fetch(`${tunnelUrl}/.well-known/did.json`);
    if (!didDocRes.ok) {
      throw new Error(`Failed to fetch did.json: HTTP ${didDocRes.status}`);
    }
    const didDoc = (await didDocRes.json()) as DidDocumentResult;
    console.log("✓ DID Document fetched successfully over public HTTPS (strict TLS):", didDoc.id);

    // 4. Issue a credential via OID4VCI Final Path (and verify Legacy path)
    // The test code acts as the Holder / Digital Wallet requesting the credential from the Issuer
    console.log("\n--- Testing OpenID4VCI 1.0 Final Issuance Path ---");
    const offerResFinal = await fetch(`${tunnelUrl}/credential-offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId: "STU-2026-FINAL",
        credential_configuration_id: "graduation_record_sd_jwt_vc",
      }),
    });
    if (!offerResFinal.ok) {
      throw new Error(`Final credential offer failed: HTTP ${offerResFinal.status} ${await offerResFinal.text()}`);
    }
    const offerDataFinal = (await offerResFinal.json()) as OfferResponseData;
    const preAuthCodeFinal =
      offerDataFinal.credential_offer.grants["urn:ietf:params:oauth:grant-type:pre-authorized_code"][
        "pre-authorized_code"
      ];

    const tokenResFinal = await fetch(`${tunnelUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:pre-authorized_code",
        "pre-authorized_code": preAuthCodeFinal,
      }).toString(),
    });
    if (!tokenResFinal.ok) {
      throw new Error(`Final token request failed: HTTP ${tokenResFinal.status} ${await tokenResFinal.text()}`);
    }
    const tokenDataFinal = (await tokenResFinal.json()) as TokenResponseData;
    const accessTokenFinal = tokenDataFinal.access_token;

    // Obtain fresh nonce from POST /nonce
    const nonceResFinal = await fetch(`${tunnelUrl}/nonce`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessTokenFinal}` },
    });
    const { c_nonce: cNonceFinal } = (await nonceResFinal.json()) as { c_nonce: string };

    // Generate ephemeral Holder key pair and sign Proof-of-Possession JWT
    const holderKeyPair = await jose.generateKeyPair("ES256", { extractable: true });
    const holderJwk = await jose.exportJWK(holderKeyPair.publicKey);
    const proofJwtFinal = await new jose.SignJWT({
      aud: tunnelUrl,
      nonce: cNonceFinal,
      iat: Math.floor(Date.now() / 1000),
    })
      .setProtectedHeader({
        alg: "ES256",
        typ: "openid4vci-proof+jwt",
        jwk: holderJwk,
      })
      .sign(holderKeyPair.privateKey);

    const credResFinal = await fetch(`${tunnelUrl}/credential`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessTokenFinal}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        credential_configuration_id: "graduation_record_sd_jwt_vc",
        proofs: {
          jwt: [proofJwtFinal],
        },
      }),
    });
    const credDataFinal = (await credResFinal.json()) as {
      credential?: string;
      credentials?: Array<{ credential: string }>;
    };
    if (!credResFinal.ok || !credDataFinal.credentials || !credDataFinal.credentials[0]?.credential) {
      throw new Error(`Final issuance path failed: HTTP ${credResFinal.status} ${JSON.stringify(credDataFinal)}`);
    }
    const rawIssuedCredential = credDataFinal.credentials[0].credential;
    const credParts = rawIssuedCredential.split("~");
    const issuerJwtPart = credParts[0];
    const allDisclosures = credParts.slice(1, -1);
    const jwtPayload = jose.decodeJwt(issuerJwtPart);
    const vctUrl = jwtPayload.vct as string;
    console.log(`✓ Final Path Issuance: SUCCESS (read from credentials[0].credential; ${allDisclosures.length} disclosures emitted)`);

    // Verify Legacy Path Issuance
    console.log("\n--- Testing OpenID4VCI Legacy Issuance Path ---");
    const offerResLegacy = await fetch(`${tunnelUrl}/credential-offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId: "STU-2026-FINAL",
        credential_configuration_id: "graduation_record_sd_jwt_vc_legacy",
      }),
    });
    if (!offerResLegacy.ok) {
      throw new Error(`Legacy credential offer failed: HTTP ${offerResLegacy.status} ${await offerResLegacy.text()}`);
    }
    const offerDataLegacy = (await offerResLegacy.json()) as OfferResponseData;
    const preAuthCodeLegacy =
      offerDataLegacy.credential_offer.grants["urn:ietf:params:oauth:grant-type:pre-authorized_code"][
        "pre-authorized_code"
      ];

    const tokenResLegacy = await fetch(`${tunnelUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:pre-authorized_code",
        "pre-authorized_code": preAuthCodeLegacy,
      }).toString(),
    });
    if (!tokenResLegacy.ok) {
      throw new Error(`Legacy token request failed: HTTP ${tokenResLegacy.status} ${await tokenResLegacy.text()}`);
    }
    const tokenDataLegacy = (await tokenResLegacy.json()) as TokenResponseData;
    const accessTokenLegacy = tokenDataLegacy.access_token;
    const cNonceLegacy = tokenDataLegacy.c_nonce;

    const proofJwtLegacy = await new jose.SignJWT({
      aud: tunnelUrl,
      nonce: cNonceLegacy,
      iat: Math.floor(Date.now() / 1000),
    })
      .setProtectedHeader({
        alg: "ES256",
        typ: "openid-credential-proof+jwt",
        jwk: holderJwk,
      })
      .sign(holderKeyPair.privateKey);

    const credResLegacy = await fetch(`${tunnelUrl}/credential`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessTokenLegacy}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        credential_configuration_id: "graduation_record_sd_jwt_vc_legacy",
        proof: {
          proof_type: "jwt",
          jwt: proofJwtLegacy,
        },
      }),
    });
    const credDataLegacy = (await credResLegacy.json()) as { credential?: string };
    if (!credResLegacy.ok || !credDataLegacy.credential) {
      throw new Error(`Legacy issuance path failed: HTTP ${credResLegacy.status} ${JSON.stringify(credDataLegacy)}`);
    }
    console.log("✓ Legacy Path Issuance: SUCCESS (read from top-level credential)");

    // =========================================================================
    // Scenario 1: Full Disclosure Presentation (Baseline)
    // -------------------------------------------------------------------------
    // The Holder presents the SD-JWT VC with ALL disclosures included.
    // Verifies that Walt.id dereferences the Issuer's did:web over public HTTPS,
    // verifies the issuer JWS signature, validates disclosure digests, and verifies
    // the holder Key Binding JWT.
    // =========================================================================
    const result1 = await runVerificationScenario({
      scenarioName: "Scenario 1: Full Disclosure (Baseline)",
      waltidBase: WALTID_BASE,
      vctUrl,
      claims: [{ path: ["studentId"] }, { path: ["dateOfBirth"] }],
      policies: [{ policy: "signature" }],
      disclosuresToInclude: allDisclosures,
      issuerJwtPart,
      holderKeyPair,
      expectedStatus: "SUCCESSFUL",
      evidenceFile: "scenario-1-full.json",
    });
    if (result1.sessionInfo.status !== "SUCCESSFUL") {
      throw new Error(`Scenario 1 failed unexpectedly: ${JSON.stringify(result1.sessionInfo.failure)}`);
    }
    console.log("✓ Scenario 1 PASSED: Full disclosure verified successfully");

    // =========================================================================
    // Scenario 2: Subset Presentation with ONLY DCQL-requested claims
    // -------------------------------------------------------------------------
    // The Holder filters disclosures, including ONLY the disclosure for dateOfBirth.
    // Disclosures for other claims (nationalId, papers/diploma, papers/transcript) are withheld.
    // Verifies that Walt.id accepts the partial disclosure presentation, and proves
    // that unrequested selectively-disclosable claims are absent from the verifier's
    // reconstructed credentialData output.
    // =========================================================================
    const subsetDisclosures = allDisclosures.filter((dStr) => {
      try {
        const decoded = decodeDisclosure(dStr);
        return decoded.type === "object" && decoded.key === "dateOfBirth";
      } catch {
        return false;
      }
    });

    console.log(`Disclosures filtered for subset presentation: ${subsetDisclosures.length} of ${allDisclosures.length}`);

    const result2 = await runVerificationScenario({
      scenarioName: "Scenario 2: Subset Selective Disclosure Presentation",
      waltidBase: WALTID_BASE,
      vctUrl,
      claims: [{ path: ["studentId"] }, { path: ["dateOfBirth"] }],
      policies: [{ policy: "signature" }],
      disclosuresToInclude: subsetDisclosures,
      issuerJwtPart,
      holderKeyPair,
      expectedStatus: "SUCCESSFUL",
      evidenceFile: "scenario-2-subset.json",
    });

    if (result2.sessionInfo.status !== "SUCCESSFUL") {
      throw new Error(`Scenario 2 failed unexpectedly: ${JSON.stringify(result2.sessionInfo.failure)}`);
    }

    // Verify unrequested claims are ABSENT from verifier reconstructed claims
    const credMap = result2.sessionInfo.presented_credentials as Record<string, Array<{
      credentialData?: Record<string, unknown>;
      signature?: { providedDisclosures?: Array<{ name?: string; value?: unknown }> };
    }>>;
    const presentedCred = credMap?.graduation_cred?.[0];
    const reconstructedClaims = presentedCred?.credentialData ?? {};
    console.log("  Reconstructed credentialData claims:", Object.keys(reconstructedClaims));

    if (reconstructedClaims.dateOfBirth !== "2002-05-15") {
      throw new Error(`Expected dateOfBirth to be '2002-05-15', got '${String(reconstructedClaims.dateOfBirth)}'`);
    }
    if (reconstructedClaims.nationalId !== undefined) {
      throw new Error("Unrequested claim 'nationalId' was unexpectedly disclosed!");
    }
    const papers = (reconstructedClaims.papers as Record<string, unknown>) ?? {};
    if (papers.diploma !== undefined || papers.transcript !== undefined) {
      throw new Error("Unrequested complex claim 'papers/diploma/transcript' was unexpectedly disclosed!");
    }
    console.log("✓ Scenario 2 PASSED: Selective disclosure verified; unrequested selectively-disclosable claims absent");

    // =========================================================================
    // Scenario 3a: Control - Omit Disclosure WITHOUT Any Extra Policy
    // -------------------------------------------------------------------------
    // The DCQL query requests dateOfBirth, but the verifier enforces no claim-level policy.
    // The Holder deliberately provides ZERO disclosures (presentation string: "issuer~" + KB-JWT).
    // Serves as a baseline control to observe verifier behavior when claims are omitted
    // in the absence of explicit presence policies.
    // =========================================================================
    const result3a = await runVerificationScenario({
      scenarioName: "Scenario 3a: Control - Omit Disclosure Without Extra Policy (DCQL requests dateOfBirth, 0 disclosures)",
      waltidBase: WALTID_BASE,
      vctUrl,
      claims: [{ path: ["dateOfBirth"] }],
      policies: [{ policy: "signature" }],
      disclosuresToInclude: [],
      issuerJwtPart,
      holderKeyPair,
      evidenceFile: "scenario-3-control-no-policy.json",
    });
    console.log(`✓ Scenario 3a Control completed: HTTP ${result3a.responseStatus}, Status: ${result3a.sessionInfo.status}`);

    // =========================================================================
    // Scenario 3b: Negative Test - Omit Disclosure WITH Regex Presence Policy
    // -------------------------------------------------------------------------
    // The verifier explicitly enforces a regex policy requiring dateOfBirth to be present.
    // The Holder provides ZERO disclosures.
    // Verifies that Walt.id fails the presentation with HTTP 400 and returns the exact
    // expected violation reason: "Could not resolve path in credential data: dateOfBirth".
    // =========================================================================
    const result3b = await runVerificationScenario({
      scenarioName: "Scenario 3b: Negative Test - Omit Disclosure With Regex Presence Policy",
      waltidBase: WALTID_BASE,
      vctUrl,
      claims: [{ path: ["dateOfBirth"] }],
      policies: [
        { policy: "signature" },
        {
          policy: "regex",
          id: "dateOfBirth-required",
          path: "dateOfBirth",
          regex: ".+",
          allowNull: false,
        } as any,
      ],
      disclosuresToInclude: [],
      issuerJwtPart,
      holderKeyPair,
      expectedStatus: "FAILED",
      evidenceFile: "scenario-3b-regex-policy.json",
    });

    if (result3b.responseStatus !== 400) {
      throw new Error(`Scenario 3b failed: expected HTTP 400, got ${result3b.responseStatus}`);
    }
    const failure3b = result3b.sessionInfo.failure as {
      type?: string;
      violations?: Array<{ policy?: { id?: string }; error?: string }>;
    } | undefined;
    const violation3b = failure3b?.violations?.[0];
    if (
      violation3b?.policy?.id !== "dateOfBirth-required" ||
      !violation3b?.error?.includes("Could not resolve path in credential data: dateOfBirth")
    ) {
      throw new Error(
        `Scenario 3b failed: expected dateOfBirth-required policy violation, got: ${JSON.stringify(failure3b)}`
      );
    }
    console.log("✓ Scenario 3b PASSED: Verifier correctly rejected presentation with specific reason:", violation3b.error);

    // =========================================================================
    // Scenario 4: Token Status List Revocation Policy (Active Credential)
    // -------------------------------------------------------------------------
    // The verifier enforces a credential-status policy using the IETF Token Status List
    // (draft-ietf-oauth-status-list-21) with expected value 0 (valid).
    // The credential at index 0 has not been revoked.
    // Verifies that Walt.id dereferences the status list over public HTTPS and accepts the credential.
    // =========================================================================
    const result4 = await runVerificationScenario({
      scenarioName: "Scenario 4: Token Status List Verification (Active Credential)",
      waltidBase: WALTID_BASE,
      vctUrl,
      claims: [{ path: ["studentId"] }],
      policies: [
        { policy: "signature" },
        {
          policy: "credential-status",
          argument: {
            discriminator: "ietf",
            value: 0,
          },
        },
      ],
      disclosuresToInclude: allDisclosures,
      issuerJwtPart,
      holderKeyPair,
      expectedStatus: "SUCCESSFUL",
      evidenceFile: "scenario-4-status-active.json",
    });

    if (result4.sessionInfo.status !== "SUCCESSFUL") {
      console.warn("  Status policy result:", JSON.stringify(result4.sessionInfo.failure ?? result4.sessionInfo.policies, null, 2));
      throw new Error(`Scenario 4 failed: Active credential rejected by status policy: ${JSON.stringify(result4.sessionInfo.failure)}`);
    }
    console.log("✓ Scenario 4 PASSED: Active credential accepted by status list policy");

    // =========================================================================
    // Scenario 5: Token Status List Revocation Policy (Revoked Credential)
    // -------------------------------------------------------------------------
    // Revokes the credential at index 0 on the Issuer via POST /admin/revoke.
    // Restarts the Walt.id container to flush its in-memory status list HTTP cache.
    // The Holder presents the revoked credential.
    // Verifies that Walt.id dereferences the updated status list, detects bit 0 = 1,
    // and rejects the presentation with HTTP 400 and the exact expected status reason.
    // =========================================================================
    console.log("\nRevoking credential index 0 via POST /admin/revoke...");
    const revokeRes = await fetch(`${tunnelUrl}/admin/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idx: 0 }),
    });
    if (!revokeRes.ok) {
      throw new Error(`Failed to revoke credential index 0: HTTP ${revokeRes.status} ${await revokeRes.text()}`);
    }
    console.log("✓ Credential revoked on issuer:", await revokeRes.text());

    restartVerifierContainer(CONTAINER_NAME);
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`${WALTID_BASE}/livez`);
        if (res.ok) break;
      } catch {
        // wait
      }
      await Bun.sleep(500);
    }

    const result5 = await runVerificationScenario({
      scenarioName: "Scenario 5: Token Status List Verification (Revoked Credential)",
      waltidBase: WALTID_BASE,
      vctUrl,
      claims: [{ path: ["studentId"] }],
      policies: [
        { policy: "signature" },
        {
          policy: "credential-status",
          argument: {
            discriminator: "ietf",
            value: 0,
          },
        },
      ],
      disclosuresToInclude: allDisclosures,
      issuerJwtPart,
      holderKeyPair,
      expectedStatus: "FAILED",
      evidenceFile: "scenario-5-status-revoked.json",
    });

    if (result5.responseStatus !== 400) {
      throw new Error(`Scenario 5 failed: expected HTTP 400, got ${result5.responseStatus}`);
    }
    const failure5 = result5.sessionInfo.failure as {
      type?: string;
      violations?: Array<{ policy?: { id?: string }; error?: string }>;
    } | undefined;
    const violation5 = failure5?.violations?.[0];
    if (
      violation5?.policy?.id !== "credential-status" ||
      !violation5?.error?.includes("Status validation failed: expected one of [0], but got 1")
    ) {
      throw new Error(`Scenario 5 failed: expected credential-status revocation violation, got: ${JSON.stringify(failure5)}`);
    }
    console.log("✓ Scenario 5 PASSED: Verifier correctly rejected revoked credential with specific reason:", violation5.error);

    console.log("\n=======================================================");
    console.log("🎉 ALL 5 INTEROPERABILITY & POLICY SCENARIOS PASSED!");
    console.log("=======================================================");

  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
