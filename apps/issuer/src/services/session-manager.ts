import crypto from "node:crypto";

/**
 * Custom error thrown when a request parameter is missing, unexpected, or malformed.
 */
export class InvalidRequestError extends Error {
  readonly code = "invalid_request";

  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

/**
 * Custom error thrown when a pre-authorized code or access grant is invalid, expired, or replayed.
 */
export class InvalidGrantError extends Error {
  readonly code = "invalid_grant";

  constructor(message: string) {
    super(message);
    this.name = "InvalidGrantError";
  }
}

/**
 * Pre-authorized code session stored prior to token exchange.
 */
export interface PreAuthorizedCodeSession {
  code: string;
  studentId: string;
  credentialConfigurationId: string;
  txCode?: string;
  claims?: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
}

/**
 * Scoped access token session created upon successful code exchange.
 */
export interface AccessTokenSession {
  accessToken: string;
  studentId: string;
  credentialConfigurationId: string;
  claims?: Record<string, unknown>;
  cNonce: string;
  cNonceExpiresAt: number;
  createdAt: number;
  expiresAt: number;
}

/**
 * Result returned from a successful pre-authorized code exchange.
 */
export interface TokenExchangeResult {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  cNonce: string;
  cNonceExpiresIn: number;
}

export interface CreatePreAuthorizedCodeOptions {
  studentId: string;
  credentialConfigurationId: string;
  txCode?: string;
  claims?: Record<string, unknown>;
  /** TTL in seconds (default: 600 - 10 minutes) */
  ttlSeconds?: number;
}

export interface ExchangePreAuthorizedCodeOptions {
  code: string;
  txCode?: string;
  /** Access token TTL in seconds (default: 600 - 10 minutes) */
  accessTokenTtlSeconds?: number;
  /** c_nonce challenge TTL in seconds (default: 600 - 10 minutes per OID4VCI) */
  cNonceTtlSeconds?: number;
}

/**
 * Default lifetimes conforming to OID4VCI 1.0 Final and OAuth 2.0 BCP.
 */
export const DEFAULT_PRE_AUTH_CODE_TTL_SECONDS = 600; // 10 minutes
export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 600; // 10 minutes
export const DEFAULT_C_NONCE_TTL_SECONDS = 600; // 10 minutes (short challenge lifetime)

/**
 * Maximum number of unpresented standalone nonces retained in memory.
 */
export const MAX_STANDALONE_NONCES = 1000;

/**
 * Timing-safe string comparison to mitigate PIN/tx_code side-channel attacks.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generates cryptographically secure base64url-encoded random string with prefix.
 *
 * @param prefix Identifier prefix (e.g. "poc_", "iat_", "cnonce_")
 * @param byteLength Number of random bytes (minimum 16 bytes = 128 bits entropy)
 */
export function generateSecureToken(prefix: string, byteLength: number = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  const base64url = Buffer.from(bytes).toString("base64url");
  return `${prefix}${base64url}`;
}

/**
 * In-memory authorization session manager for OID4VCI 1.0 Final.
 *
 * Enforces single-use atomic code burning (replay defense) and strict TTL expiration.
 */
export class SessionManager {
  private readonly preAuthCodes = new Map<string, PreAuthorizedCodeSession>();
  private readonly accessTokens = new Map<string, AccessTokenSession>();
  private readonly standaloneNonces = new Map<string, number>();
  private readonly cleanupIntervalId?: ReturnType<typeof setInterval>;

  constructor() {
    if (typeof setInterval !== "undefined") {
      this.cleanupIntervalId = setInterval(() => {
        this.cleanupExpired();
      }, 60000);
      if (
        this.cleanupIntervalId &&
        typeof (this.cleanupIntervalId as any).unref === "function"
      ) {
        (this.cleanupIntervalId as any).unref();
      }
    }
  }

  /**
   * Stops the background cleanup interval if running.
   */
  stopCleanup(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
    }
  }

  /**
   * Creates and stores a new pre-authorized code session.
   *
   * @param options Configuration for the session
   * @returns Created PreAuthorizedCodeSession object
   */
  createPreAuthorizedCode(options: CreatePreAuthorizedCodeOptions): PreAuthorizedCodeSession {
    if (!options.studentId || options.studentId.trim().length === 0) {
      throw new Error("studentId must be a non-empty string");
    }
    if (!options.credentialConfigurationId || options.credentialConfigurationId.trim().length === 0) {
      throw new Error("credentialConfigurationId must be a non-empty string");
    }

    const ttl = options.ttlSeconds ?? DEFAULT_PRE_AUTH_CODE_TTL_SECONDS;
    const now = Date.now();
    const code = generateSecureToken("poc_", 32);

    const session: PreAuthorizedCodeSession = {
      code,
      studentId: options.studentId.trim(),
      credentialConfigurationId: options.credentialConfigurationId.trim(),
      txCode: options.txCode?.trim(),
      claims: options.claims,
      createdAt: now,
      expiresAt: now + ttl * 1000,
    };

    this.preAuthCodes.set(code, session);
    return session;
  }

  /**
   * Atomically exchanges a pre-authorized code for an access token and c_nonce.
   *
   * Enforces single-use atomic code burning (mitigating brute-force PIN guessing):
   * the pre-authorized code is deleted immediately on exchange attempt, so any failed
   * attempt (including wrong or missing PIN) burns the pre-authorized code permanently.
   *
   * Parameter & PIN validation rules:
   * 1. tx_code supplied but not expected -> InvalidRequestError ("invalid_request")
   * 2. tx_code expected but missing -> InvalidRequestError ("invalid_request")
   * 3. tx_code wrong -> InvalidGrantError ("invalid_grant")
   *
   * @param options Exchange options including the code and optional txCode
   * @returns TokenExchangeResult with accessToken and cNonce
   * @throws InvalidRequestError if parameters are missing or unexpected
   * @throws InvalidGrantError if code is invalid, expired, or PIN does not match
   */
  exchangePreAuthorizedCode(options: ExchangePreAuthorizedCodeOptions): TokenExchangeResult {
    const { code, txCode } = options;

    if (!code || typeof code !== "string" || code.trim().length === 0) {
      throw new InvalidRequestError("The pre-authorized code must be provided");
    }

    const session = this.preAuthCodes.get(code);

    if (!session) {
      throw new InvalidGrantError("The pre-authorized code is invalid, expired, or has already been used");
    }

    // ATOMIC BURN: Delete the pre-authorized code immediately regardless of outcome.
    // Even if PIN/tx_code check fails, the pre-authorized code is burned to prevent brute-force attacks.
    this.preAuthCodes.delete(code);

    // Check expiration
    const now = Date.now();
    if (now > session.expiresAt) {
      throw new InvalidGrantError("The pre-authorized code has expired");
    }

    // 1. tx_code supplied but not expected -> invalid_request
    if (session.txCode === undefined && txCode !== undefined && txCode.trim().length > 0) {
      throw new InvalidRequestError("Transaction code (PIN) was supplied but not expected for this credential offer");
    }

    // 2. tx_code expected but missing -> invalid_request
    if (session.txCode !== undefined) {
      if (!txCode || txCode.trim().length === 0) {
        throw new InvalidRequestError("Transaction code (PIN) is required for this credential offer");
      }
      // 3. tx_code wrong -> invalid_grant
      if (!timingSafeCompare(session.txCode, txCode.trim())) {
        throw new InvalidGrantError("Invalid transaction code (PIN)");
      }
    }

    // Issue access token and initial c_nonce
    const accessTokenTtl = options.accessTokenTtlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
    const cNonceTtl = options.cNonceTtlSeconds ?? DEFAULT_C_NONCE_TTL_SECONDS;

    const accessToken = generateSecureToken("iat_", 32);
    const cNonce = generateSecureToken("cnonce_", 32);

    const accessSession: AccessTokenSession = {
      accessToken,
      studentId: session.studentId,
      credentialConfigurationId: session.credentialConfigurationId,
      claims: session.claims,
      cNonce,
      cNonceExpiresAt: now + cNonceTtl * 1000,
      createdAt: now,
      expiresAt: now + accessTokenTtl * 1000,
    };

    this.accessTokens.set(accessToken, accessSession);

    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn: accessTokenTtl,
      cNonce,
      cNonceExpiresIn: cNonceTtl,
    };
  }

  /**
   * Consumes and removes an access token session upon successful credential issuance (one-shot issuance).
   *
   * @param token Bearer access token string
   * @returns true if session was found and removed, false otherwise
   */
  consumeAccessToken(token: string): boolean {
    if (!token || typeof token !== "string") {
      return false;
    }
    return this.accessTokens.delete(token);
  }

  /**
   * Retrieves an active AccessTokenSession by token string, validating expiration.
   *
   * @param token Bearer access token string
   * @returns Active AccessTokenSession or undefined if invalid/expired
   */
  getAccessTokenSession(token: string): AccessTokenSession | undefined {
    if (!token || typeof token !== "string") {
      return undefined;
    }

    const session = this.accessTokens.get(token);
    if (!session) {
      return undefined;
    }

    if (Date.now() > session.expiresAt) {
      this.accessTokens.delete(token);
      return undefined;
    }

    return session;
  }

  /**
   * Generates a fresh standalone c_nonce challenge per OpenID4VCI 1.0 Final.
   *
   * Sweeps expired standalone nonces on insert and caps memory size.
   */
  generateStandaloneNonce(ttlSeconds: number = DEFAULT_C_NONCE_TTL_SECONDS): {
    cNonce: string;
    cNonceExpiresIn: number;
  } {
    const now = Date.now();
    // Sweep expired entries on insert
    for (const [key, expiresAt] of this.standaloneNonces.entries()) {
      if (now > expiresAt) {
        this.standaloneNonces.delete(key);
      }
    }
    // Cap size: evict oldest if at capacity
    if (this.standaloneNonces.size >= MAX_STANDALONE_NONCES) {
      const oldestKey = this.standaloneNonces.keys().next().value;
      if (oldestKey) {
        this.standaloneNonces.delete(oldestKey);
      }
    }

    const cNonce = generateSecureToken("cnonce_", 32);
    this.standaloneNonces.set(cNonce, now + ttlSeconds * 1000);
    return {
      cNonce,
      cNonceExpiresIn: ttlSeconds,
    };
  }

  /**
   * Generates and assigns a fresh c_nonce to an active access token session.
   */
  rotateSessionNonce(token: string): string | undefined {
    const session = this.getAccessTokenSession(token);
    if (!session) {
      return undefined;
    }
    const newNonce = generateSecureToken("cnonce_", 32);
    session.cNonce = newNonce;
    session.cNonceExpiresAt = Date.now() + DEFAULT_C_NONCE_TTL_SECONDS * 1000;
    return newNonce;
  }

  /**
   * Checks whether a nonce challenge is valid for the given session or as an unexpired standalone nonce,
   * without consuming or mutating it.
   *
   * Validates standalone nonces independently of the session nonce's expiry.
   *
   * @param session Active AccessTokenSession
   * @param nonce Nonce string presented in holder proof
   * @returns true if valid and unexpired, false otherwise
   */
  isValidNonce(session: AccessTokenSession, nonce: string): boolean {
    if (!nonce || typeof nonce !== "string") {
      return false;
    }
    const now = Date.now();
    if (
      session.cNonce &&
      timingSafeCompare(session.cNonce, nonce) &&
      now <= session.cNonceExpiresAt
    ) {
      return true;
    }
    if (this.standaloneNonces.has(nonce)) {
      const exp = this.standaloneNonces.get(nonce)!;
      if (now <= exp) {
        return true;
      }
    }
    return false;
  }

  /**
   * Validates a c_nonce against an active access token session, marks the access token as used
   * synchronously to prevent race conditions during concurrent issuance, and generates a fresh nonce.
   *
   * Standalone nonces are validated independently of whether the session's internal cNonce has expired.
   *
   * @param token Bearer access token string
   * @param nonce Nonce string presented in holder proof
   * @returns Object indicating validity and presenting a fresh cNonce and session if valid
   */
  validateAndRotateNonce(
    token: string,
    nonce: string
  ): { valid: boolean; newNonce?: string; error?: string; session?: AccessTokenSession } {
    const session = this.getAccessTokenSession(token);
    if (!session) {
      return { valid: false, error: "invalid_token" };
    }

    const now = Date.now();
    let nonceValid = false;

    // 1. Check against session cNonce
    if (session.cNonce && timingSafeCompare(session.cNonce, nonce)) {
      if (now <= session.cNonceExpiresAt) {
        nonceValid = true;
      } else {
        return { valid: false, error: "expired_nonce" };
      }
    } else if (this.standaloneNonces.has(nonce)) {
      // 2. Validate standalone nonces independently of the session nonce's expiry
      const exp = this.standaloneNonces.get(nonce)!;
      this.standaloneNonces.delete(nonce); // atomic single-use burn
      if (now <= exp) {
        nonceValid = true;
      } else {
        return { valid: false, error: "expired_nonce" };
      }
    }

    if (!nonceValid) {
      return { valid: false, error: "mismatched_nonce" };
    }

    // ATOMIC MARK USED: Immediately delete the access token session from active accessTokens
    // synchronously so that concurrent requests with the same token fail immediately at nonce validation
    this.accessTokens.delete(token);

    // Nonce verified; rotate to fresh c_nonce for next interaction
    const newNonce = generateSecureToken("cnonce_", 32);
    session.cNonce = newNonce;
    session.cNonceExpiresAt = now + DEFAULT_C_NONCE_TTL_SECONDS * 1000;

    return { valid: true, newNonce, session };
  }

  /**
   * Cleans up expired sessions and standalone nonces from memory.
   */
  cleanupExpired(): void {
    const now = Date.now();

    for (const [code, session] of this.preAuthCodes.entries()) {
      if (now > session.expiresAt) {
        this.preAuthCodes.delete(code);
      }
    }

    for (const [token, session] of this.accessTokens.entries()) {
      if (now > session.expiresAt) {
        this.accessTokens.delete(token);
      }
    }

    for (const [nonce, expiresAt] of this.standaloneNonces.entries()) {
      if (now > expiresAt) {
        this.standaloneNonces.delete(nonce);
      }
    }
  }

  /**
   * Clears all sessions and nonces (primarily for test resets).
   */
  clear(): void {
    this.preAuthCodes.clear();
    this.accessTokens.clear();
    this.standaloneNonces.clear();
  }

  /**
   * Number of currently registered pre-authorized code sessions (including unexpired/expired).
   */
  get preAuthCodeCount(): number {
    return this.preAuthCodes.size;
  }

  /**
   * Number of currently registered access token sessions.
   */
  get accessTokenCount(): number {
    return this.accessTokens.size;
  }
}
