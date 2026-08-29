import { strict as assert } from "node:assert";
import { test } from "node:test";

import { loadConfig } from "../src/config.js";

test("loads secure Hoomi defaults with explicit runtime values", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    HOOMI_JWT_SECRET: "a-secure-production-secret-that-is-long-enough",
    HOOMI_API_BASE_URL: "https://api.hoomi.social",
    SECRET_HANDOFF_STORE: "redis",
    REDIS_URL: "redis://:test-password@localhost:6379",
    SECRET_HANDOFF_ENCRYPTION_KEY: "a-secure-secret-handoff-key-that-is-long-enough",
    MCP_ALLOWED_HOSTS: "mcp.hoomi.social,localhost",
    MCP_ALLOWED_ORIGINS: "https://app.hoomi.social"
  });

  assert.equal(config.port, 8300);
  assert.equal(config.authMode, "hoomi-session");
  assert.deepEqual(config.allowedHosts, ["mcp.hoomi.social", "localhost"]);
  assert.deepEqual(config.allowedOrigins, ["https://app.hoomi.social"]);
  assert.equal(config.hoomiApiBaseUrl, "https://api.hoomi.social");
  assert.equal(config.sdkSourceDir, "/opt/hoomi-sdk-source");
});

test("requires an explicit HTTPS upstream in production", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        HOOMI_JWT_SECRET: "a-secure-production-secret-that-is-long-enough",
        SECRET_HANDOFF_STORE: "redis",
        REDIS_URL: "redis://:test-password@localhost:6379",
        SECRET_HANDOFF_ENCRYPTION_KEY: "a-secure-secret-handoff-key-that-is-long-enough"
      }),
    /HOOMI_API_BASE_URL is required in production/
  );

  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        HOOMI_JWT_SECRET: "a-secure-production-secret-that-is-long-enough",
        HOOMI_API_BASE_URL: "http://api.hoomi.social",
        SECRET_HANDOFF_STORE: "redis",
        REDIS_URL: "redis://:test-password@localhost:6379",
        SECRET_HANDOFF_ENCRYPTION_KEY: "a-secure-secret-handoff-key-that-is-long-enough"
      }),
    /must use HTTPS in production/
  );
});

test("rejects insecure auth in production", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        MCP_AUTH_MODE: "disabled",
        ALLOW_INSECURE_LOCAL: "true",
        SECRET_HANDOFF_STORE: "redis",
        REDIS_URL: "redis://:test-password@localhost:6379",
        SECRET_HANDOFF_ENCRYPTION_KEY: "a-secure-secret-handoff-key-that-is-long-enough"
      }),
    /non-production NODE_ENV/
  );
});

test("requires an explicit opt-in for local unauthenticated mode", () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: "development", MCP_AUTH_MODE: "disabled", SECRET_HANDOFF_STORE: "memory" }),
    /ALLOW_INSECURE_LOCAL=true/
  );
});

test("rejects overlapping MCP auxiliary paths", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        HOOMI_JWT_SECRET: "a-secure-production-secret-that-is-long-enough",
        HOOMI_API_BASE_URL: "https://api.hoomi.social",
        SECRET_HANDOFF_STORE: "redis",
        REDIS_URL: "redis://:test-password@localhost:6379",
        SECRET_HANDOFF_ENCRYPTION_KEY: "a-secure-secret-handoff-key-that-is-long-enough",
        WRITE_APPROVAL_PATH: "/mcp/approval"
      }),
    /paths must not overlap/
  );
});
