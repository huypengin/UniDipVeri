import * as jose from "jose";
import * as zlib from "node:zlib";
import { resolveDidVerificationKey, type FetchLike } from "../did/did-resolver.js";

/**
 * Expected typ header for Token Status List tokens per draft-ietf-oauth-status-list-21 Section 5.1.
 */
export const STATUS_LIST_TOKEN_TYP = "statuslist+jwt";

/**
 * Result of dereferencing and parsing a verified Status List Token.
 */
export interface VerifiedStatusListToken {
  /** Issuer of the status list token (iss claim) */
  issuer: string;
  /** Subject status list URI (sub claim) */
  subject: string;
  /** Number of bits allocated per credential status (status_list.bits) */
  bits: number;
  /** Compressed base64url bitstring (status_list.lst) */
  lst: string;
  /** Complete verified JWT payload */
  payload: jose.JWTPayload;
}

/**
 * Options for verifying a Status List Token JWS.
 */
export interface VerifyStatusListTokenOptions {
  /** Custom callback to resolve issuer public verification key */
  resolveIssuerKey?: (issuer: string, kid?: string) => Promise<jose.JWK>;
  /** Acceptable clock tolerance in seconds */
  clockToleranceSeconds?: number;
  /** Fetch function for resolving did:web if issuer is a DID */
  fetchFn?: FetchLike;
}

/**
 * Result of evaluating a credential's status list position.
 */
export interface CredentialStatusEvaluation {
  /** Whether the credential is confirmed revoked (bit === 1) */
  revoked: boolean;
  /** Status string: "ACTIVE" or "REVOKED" */
  status: "ACTIVE" | "REVOKED";
  /** Status index evaluated in the bitstring */
  idx: number;
  /** Status list URI evaluated */
  uri: string;
}

/**
 * Decompresses an lst string and reads the bit value at a specified index per draft-ietf-oauth-status-list-21 Section 4.2.
 * Uses unzipSync to automatically handle both zlib (RFC 1950) and gzip (RFC 1952) compression formats.
 *
 * @param lst base64url-encoded compressed bit array
 * @param index Bit index of the referenced token
 * @param bits Number of bits per token (default: 1).
 * @returns Status value (0 = valid/active, 1 = revoked)
 */
export function decompressAndGetBit(lst: string, index: number, bits = 1): number {
  if (typeof lst !== "string" || lst.trim().length === 0) {
    throw new Error("Status list lst parameter must be a non-empty string");
  }

  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid status list index ${index}: index must be a non-negative integer`);
  }

  if (bits !== 1) {
    throw new Error(`Unsupported bits allocation: ${bits}. Only 1-bit allocation is currently supported.`);
  }

  let compressed: Uint8Array;
  try {
    compressed = jose.base64url.decode(lst);
  } catch (err) {
    throw new Error(
      `Failed to base64url-decode status list lst: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let decompressed: Buffer;
  try {
    decompressed = zlib.unzipSync(compressed);
  } catch (err) {
    throw new Error(
      `Failed to decompress status list bitstring: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const byteIndex = Math.floor(index / 8);
  if (byteIndex >= decompressed.length) {
    throw new Error(
      `Index ${index} is out of bounds for decompressed status list of ${decompressed.length * 8} bits`
    );
  }

  const bitShift = index % 8;
  return (decompressed[byteIndex] >> bitShift) & 1;
}

/**
 * Verifies a Token Status List JWT per draft-ietf-oauth-status-list-21 Section 5.1.
 *
 * Checks:
 * 1. Protected header typ === "statuslist+jwt"
 * 2. Signature verification against issuer public key (via callback or did:web resolution)
 * 3. Standard claims: iss, sub, exp, status_list
 *
 * @param tokenJwt Raw compact JWT string
 * @param options Options including key resolver, clock tolerance, and fetch implementation
 * @returns Verified status list token details
 */
export async function verifyStatusListToken(
  tokenJwt: string,
  options: VerifyStatusListTokenOptions = {}
): Promise<VerifiedStatusListToken> {
  if (typeof tokenJwt !== "string" || tokenJwt.trim().length === 0) {
    throw new Error("Status List Token must be a non-empty string");
  }

  const parts = tokenJwt.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid Status List Token: must be a compact JWS with 3 parts");
  }

  let protectedHeader: { alg?: string; typ?: string; kid?: string };
  try {
    protectedHeader = JSON.parse(
      new TextDecoder().decode(jose.base64url.decode(parts[0]))
    );
  } catch (err) {
    throw new Error(
      `Invalid Status List Token header: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (protectedHeader.typ !== STATUS_LIST_TOKEN_TYP) {
    throw new Error(
      `Invalid Status List Token typ header: expected '${STATUS_LIST_TOKEN_TYP}', received '${protectedHeader.typ}'`
    );
  }

  let unverifiedPayload: Record<string, unknown>;
  try {
    unverifiedPayload = JSON.parse(
      new TextDecoder().decode(jose.base64url.decode(parts[1]))
    );
  } catch (err) {
    throw new Error(
      `Invalid Status List Token payload JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const iss = unverifiedPayload.iss;
  if (typeof iss !== "string" || iss.trim().length === 0) {
    throw new Error("Status List Token missing required 'iss' claim");
  }

  // Resolve public key
  let publicKeyJwk: jose.JWK;
  if (options.resolveIssuerKey) {
    publicKeyJwk = await options.resolveIssuerKey(iss, protectedHeader.kid);
  } else if (iss.startsWith("did:web:")) {
    const resolved = await resolveDidVerificationKey(
      iss,
      protectedHeader.kid,
      options.fetchFn
    );
    publicKeyJwk = resolved.publicKeyJwk;
  } else {
    throw new Error(
      `No key resolver available for Status List Token issuer '${iss}'`
    );
  }

  const alg = protectedHeader.alg || (publicKeyJwk.alg as string) || "ES256";
  const key = await jose.importJWK(publicKeyJwk, alg);

  const verifyResult = await jose.jwtVerify(tokenJwt, key, {
    algorithms: [alg],
    clockTolerance: options.clockToleranceSeconds ?? 0,
  });

  const payload = verifyResult.payload;

  if (typeof payload.sub !== "string" || payload.sub.trim().length === 0) {
    throw new Error("Status List Token missing required 'sub' claim");
  }

  const statusList = payload.status_list as
    | { bits?: unknown; lst?: unknown }
    | undefined;
  if (
    !statusList ||
    typeof statusList !== "object" ||
    typeof statusList.lst !== "string" ||
    typeof statusList.bits !== "number"
  ) {
    throw new Error(
      "Status List Token payload missing valid 'status_list' object with 'bits' and 'lst'"
    );
  }

  return {
    issuer: payload.iss as string,
    subject: payload.sub as string,
    bits: statusList.bits,
    lst: statusList.lst,
    payload,
  };
}

/**
 * Checks a credential's revocation status by dereferencing its Token Status List pointer per
 * draft-ietf-oauth-status-list-21 and draft-ietf-oauth-sd-jwt-vc-19 Section 3.2.2.
 *
 * @param statusListRef Object containing uri and idx from credential payload status.status_list
 * @param options Verification options
 * @returns Status evaluation result (ACTIVE or REVOKED)
 */
export async function checkCredentialStatus(
  statusListRef: { uri: string; idx: number },
  options: VerifyStatusListTokenOptions = {}
): Promise<CredentialStatusEvaluation> {
  const { uri, idx } = statusListRef;

  if (!uri || typeof uri !== "string") {
    throw new Error("Status list reference must contain a valid string 'uri'");
  }

  if (!Number.isInteger(idx) || idx < 0) {
    throw new Error(`Status list reference 'idx' must be a non-negative integer, received ${idx}`);
  }

  const fetchFn = options.fetchFn ?? fetch;

  let response: Response;
  try {
    response = await fetchFn(uri, {
      headers: {
        Accept: "application/statuslist+jwt, application/jwt, text/plain",
      },
    });
  } catch (err) {
    throw new Error(
      `Network failure fetching Status List Token from '${uri}': ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Status List Token from '${uri}': HTTP status ${response.status} ${response.statusText}`
    );
  }

  const tokenJwt = (await response.text()).trim();
  const verifiedToken = await verifyStatusListToken(tokenJwt, options);

  if (verifiedToken.subject !== uri) {
    throw new Error(
      `Status List Token 'sub' mismatch: expected '${uri}', received '${verifiedToken.subject}'`
    );
  }

  const bit = decompressAndGetBit(verifiedToken.lst, idx, verifiedToken.bits);
  const revoked = bit === 1;

  return {
    revoked,
    status: revoked ? "REVOKED" : "ACTIVE",
    idx,
    uri,
  };
}
