import { loadSchemaFromFile, resolveVct } from "@unidipveri/core";
import { loadIssuerConfig } from "./config.js";
import { initializeKeyManager } from "./services/key-manager.js";
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

  const app = createApp(config, keyContext, schemaConfig);

  const server = Bun.serve({
    port: config.port,
    fetch: app,
  });

  return {
    server,
    config,
    keyContext,
    schemaConfig,
  };
}

// Run directly when invoked as main module
if (import.meta.main) {
  startServer()
    .then(({ server, config, schemaConfig, keyContext }) => {
      console.log(`[UniDipVeri Issuer] Running at http://localhost:${server.port}`);
      console.log(`[UniDipVeri Issuer] Base URL: ${config.baseUrl}`);
      console.log(`[UniDipVeri Issuer] Issuer DID: ${config.issuerDid} (${keyContext.alg}, kid: ${keyContext.keyId})`);
      console.log(`[UniDipVeri Issuer] Credential VCT: ${resolveVct(schemaConfig.vctPath, config.vctBaseUrl)}`);
      console.log(`[UniDipVeri Issuer] Discovery Endpoints:`);
      console.log(`  - OID4VCI Metadata: ${config.baseUrl}/.well-known/openid-credential-issuer`);
      console.log(`  - DID Document:     ${config.baseUrl}/.well-known/did.json`);
      console.log(`  - Type Metadata:    ${config.baseUrl}/types/*`);
      console.log(`  - Health Check:     ${config.baseUrl}/health`);
    })
    .catch((err) => {
      console.error("[UniDipVeri Issuer] Startup failed:", err);
      process.exit(1);
    });
}
