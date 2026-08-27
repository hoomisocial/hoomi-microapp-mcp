import { strict as assert } from "node:assert";
import { test } from "node:test";

import { loadConfig } from "../src/config.js";

test("loads secure Hoomi defaults with explicit runtime values", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    HOOMI_JWT_SECRET: "a-secure-production-secret-that-is-long-enough",
    MCP_ALLOWED_HOSTS: "mcp.hoomi.social,localhost",
    MCP_ALLOWED_ORIGINS: "https://app.hoomi.social"
  });

  assert.equal(config.port, 8300);
  assert.equal(config.authMode, "hoomi-session");
  assert.deepEqual(config.allowedHosts, ["mcp.hoomi.social", "localhost"]);
  assert.deepEqual(config.allowedOrigins, ["https://app.hoomi.social"]);
  assert.equal(config.hoomiApiBaseUrl, "https://apidev.hoomi.social");
});

test("rejects insecure auth in production", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        MCP_AUTH_MODE: "disabled",
        ALLOW_INSECURE_LOCAL: "true"
      }),
    /non-production NODE_ENV/
  );
});

test("requires an explicit opt-in for local unauthenticated mode", () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: "development", MCP_AUTH_MODE: "disabled" }),
    /ALLOW_INSECURE_LOCAL=true/
  );
});
