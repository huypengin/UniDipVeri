import crypto from "node:crypto";

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
  /** c_nonce challenge TTL in seconds (default: 86400 - 24 hours per OID4VCI) */
  cNonceTtlSeconds?: number;
}

/**
 * Default lifetimes conforming to OID4VCI 1.0 Final and OAuth 2.0 BCP.
 */
export const DEFAULT_PRE_AUTH_CODE_TTL_SECONDS = 600; // 10 minutes
export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 600; // 10 minutes
export const DEFAULT_C_NONCE_TTL_SECONDS = 86400; // 24 hours

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
   * Burns the pre-authorized code immediately to prevent replay attacks.
   *
   * @param options Exchange options including the code and optional txCode
   * @returns TokenExchangeResult with accessToken and cNonce
   * @throws InvalidGrantError if code is missing, invalid, expired, or txCode does not match
   */
  exchangePreAuthorizedCode(options: ExchangePreAuthorizedCodeOptions): TokenExchangeResult {
    const { code, txCode } = options;

    if (!code || typeof code !== "string" || code.trim().length === 0) {
      throw new InvalidGrantError("The pre-authorized code must be provided");
    }

    const session = this.preAuthCodes.get(code);

    if (!session) {
      throw new InvalidGrantError("The pre-authorized code is invalid, expired, or has already been used");
    }

    // ATOMIC BURN: Delete the pre-authorized code immediately regardless of outcome
    this.preAuthCodes.delete(code);

    // Check expiration
    const now = Date.now();
    if (now > session.expiresAt) {
      throw new InvalidGrantError("The pre-authorized code has expired");
    }

    // Check tx_code (PIN) if configured for this session
    if (session.txCode !== undefined) {
      if (!txCode || !timingSafeCompare(session.txCode, txCode.trim())) {
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
   * Validates a c_nonce against an active access token session and generates a fresh nonce.
   *
   * Conforms to OID4VCI Section 7.2 requirement for nonce rotation during credential requests.
   *
   * @param token Bearer access token string
   * @param nonce Nonce string presented in holder proof
   * @returns Object indicating validity and presenting a fresh cNonce if valid
   */
  validateAndRotateNonce(
    token: string,
    nonce: string
  ): { valid: boolean; newNonce?: string; error?: string } {
    const session = this.getAccessTokenSession(token);
    if (!session) {
      return { valid: false, error: "invalid_token" };
    }

    const now = Date.now();
    if (now > session.cNonceExpiresAt) {
      return { valid: false, error: "expired_nonce" };
    }

    if (!timingSafeCompare(session.cNonce, nonce)) {
      return { valid: false, error: "mismatched_nonce" };
    }

    // Nonce verified; rotate to fresh c_nonce for next interaction
    const newNonce = generateSecureToken("cnonce_", 32);
    session.cNonce = newNonce;
    session.cNonceExpiresAt = now + DEFAULT_C_NONCE_TTL_SECONDS * 1000;

    return { valid: true, newNonce };
  }

  /**
   * Cleans up expired sessions from memory.
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
  }

  /**
   * Clears all sessions (primarily for test resets).
   */
  clear(): void {
    this.preAuthCodes.clear();
    this.accessTokens.clear();
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
