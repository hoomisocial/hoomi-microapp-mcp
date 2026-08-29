import { strict as assert } from "node:assert";
import { test } from "node:test";

import { SignJWT } from "jose";

import { authenticateRequest, AuthenticationError } from "../src/auth.js";
import type { AppConfig } from "../src/config.js";

const secret = "a-secure-test-secret-that-is-long-enough";
const config: AppConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 8300,
  mcpPath: "/mcp",
  authMode: "hoomi-session",
  hoomiJwtSecret: secret,
  hoomiJwtIssuer: "HOOMI-API",
  hoomiJwtAudience: undefined,
  hoomiApiBaseUrl: "https://apidev.hoomi.social",
  hoomiRequestTimeoutMs: 10_000,
  hoomiMaxResponseBytes: 2_000_000,
  maxToolOutputBytes: 200_000,
  sdkSourceDir: "/opt/hoomi-sdk-source",
  sdkRevision: undefined,
  secretHandoffStore: "memory",
  secretHandoffTtlSeconds: 300,
  writeApprovalTtlSeconds: 120,
  secretHandoffPath: "/v1/secret-handoffs",
  writeApprovalPath: "/v1/write-approvals",
  allowedHosts: ["127.0.0.1"],
  allowedOrigins: []
};

test("accepts a valid Hoomi session JWT", async () => {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("HOOMI-API")
    .setSubject("42")
    .setIssuedAt()
    .setExpirationTime("5 minutes")
    .sign(new TextEncoder().encode(secret));

  const principal = await authenticateRequest(`Bearer ${token}`, config);

  assert.equal(principal.userId, 42);
  assert.equal(principal.mode, "hoomi-session");
  assert.equal(principal.sessionToken, token);
});

test("rejects a missing authorization header", async () => {
  await assert.rejects(
    () => authenticateRequest(undefined, config),
    (error: unknown) => error instanceof AuthenticationError
  );
});

test("rejects a token with the wrong issuer", async () => {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("not-hoomi")
    .setSubject("42")
    .setExpirationTime("5 minutes")
    .sign(new TextEncoder().encode(secret));

  await assert.rejects(
    () => authenticateRequest(`Bearer ${token}`, config),
    (error: unknown) => error instanceof AuthenticationError
  );
});

test("enforces the configured JWT audience when present", async () => {
  const audienceConfig = { ...config, hoomiJwtAudience: "hoomi-mcp" };
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("HOOMI-API")
    .setAudience("another-service")
    .setSubject("42")
    .setExpirationTime("5 minutes")
    .sign(new TextEncoder().encode(secret));

  await assert.rejects(
    () => authenticateRequest(`Bearer ${token}`, audienceConfig),
    (error: unknown) => error instanceof AuthenticationError
  );
});
