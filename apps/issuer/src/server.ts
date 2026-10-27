import {
  loadSchemaFromFile,
  resolveVct,
  resolveIssuerKeyId,
} from "@unidipveri/core";
import { loadIssuerConfig } from "./config.js";
import { initializeKeyManager } from "./services/key-manager.js";
import { SessionManager } from "./services/session-manager.js";
import { StudentRecordService } from "./services/student-records.js";
import { StatusListService, DEFAULT_STATUS_LIST_CAPACITY } from "./services/status-list.js";
import { createApp } from "./app.js";

/**
 * Boots the HTTP server with loaded configuration, schema, and initialized keys.
 *
 * @param configOverrides Optional environment variable overrides (useful for testing)
 * @returns Bun Server instance and runtime context
 */
export async function startServer(
  configOverrides: Record<string, string | undefined> = {}
) {
  const config = loadIssuerConfig(configOverrides);
  const schemaConfig = await loadSchemaFromFile(config.schemaPath);
  const keyContext = await initializeKeyManager(config);
  const sessionManager = new SessionManager();
  const studentRecordsService = new StudentRecordService();
  const statusListService = new StatusListService(DEFAULT_STATUS_LIST_CAPACITY, config.statusListPath);

  const app = createApp(
    config,
    keyContext,
    schemaConfig,
    sessionManager,
    studentRecordsService,
    statusListService
  );

  const server = Bun.serve({
    port: config.port,
    fetch: app,
  });

  return {
    server,
    config,
    keyContext,
    schemaConfig,
    sessionManager,
    studentRecordsService,
    statusListService,
  };
}

// Run directly when invoked as main module
if (import.meta.main) {
  startServer()
    .then(({ server, config, schemaConfig, keyContext }) => {
      console.log(`[UniDipVeri Issuer] Running at http://localhost:${server.port}`);
      console.log(`[UniDipVeri Issuer] Base URL: ${config.baseUrl}`);
      const effectiveKid = resolveIssuerKeyId(config.issuerDid, keyContext.keyId);
      console.log(`[UniDipVeri Issuer] Issuer DID: ${config.issuerDid} (${keyContext.alg}, kid: ${effectiveKid})`);
      console.log(`[UniDipVeri Issuer] Credential VCT: ${resolveVct(schemaConfig.vctPath, config.vctBaseUrl)}`);
      console.log(`[UniDipVeri Issuer] Available Endpoints:`);
      console.log(`  - Registrar Portal:  ${config.baseUrl}/`);
      console.log(`  - Swagger UI & Docs: ${config.baseUrl}/docs`);
      console.log(`  - OID4VCI Metadata:  ${config.baseUrl}/.well-known/openid-credential-issuer`);
      console.log(`  - OAuth Metadata:    ${config.baseUrl}/.well-known/oauth-authorization-server`);
      console.log(`  - DID Document:      ${config.baseUrl}/.well-known/did.json`);
      console.log(`  - JWT VC Issuer:     ${config.baseUrl}/.well-known/jwt-vc-issuer`);
      console.log(`  - Type Metadata:     ${config.baseUrl}/types/*`);
      console.log(`  - Credential Offer:  ${config.baseUrl}/credential-offer`);
      console.log(`  - Token Endpoint:    ${config.baseUrl}/token`);
      console.log(`  - Nonce Endpoint:    ${config.baseUrl}/nonce`);
      console.log(`  - Credential Issue:  ${config.baseUrl}/credential`);
      console.log(`  - Status List:       ${config.baseUrl}/status/status-list-1`);
      console.log(`  - Admin Revocation:  ${config.baseUrl}/admin/revoke`);
      console.log(`  - Health Check:      ${config.baseUrl}/health`);
    })
    .catch((err) => {
      console.error("[UniDipVeri Issuer] Startup failed:", err);
      process.exit(1);
    });
}
