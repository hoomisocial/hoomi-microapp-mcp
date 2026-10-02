import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  authenticateRequest,
  AuthenticationError,
  AuthenticationUnavailableError
} from "../src/auth.js";
import type { AppConfig } from "../src/config.js";

const config: AppConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 8300,
  mcpPath: "/mcp",
  authMode: "hoomi-session",
  hoomiApiBaseUrl: "https://apidev.hoomi.social",
  hoomiRequestTimeoutMs: 10_000,
  hoomiMaxResponseBytes: 2_000_000,
  maxToolOutputBytes: 200_000,
  sdkSourceDir: "/opt/hoomi-sdk-source",
  sdkRevision: undefined,
  sdkSourceDigest: undefined,
  secretHandoffStore: "memory",
  secretHandoffTtlSeconds: 300,
  writeApprovalTtlSeconds: 120,
  secretHandoffPath: "/v1/secret-handoffs",
  writeApprovalPath: "/v1/write-approvals",
  allowedHosts: ["127.0.0.1"],
  allowedOrigins: []
};

test("validates the incoming bearer with Hoomi and binds its verified profile", async () => {
  const token = "browser-session-token";
  const principal = await authenticateRequest(`Bearer ${token}`, config, async (input, init) => {
    assert.equal(String(input), "https://apidev.hoomi.social/v2/profile");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${token}`);
    return new Response(JSON.stringify({ success: true, data: { id: 42 } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });

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

test("rejects a token that Hoomi does not accept", async () => {
  await assert.rejects(
    () => authenticateRequest("Bearer invalid-token", config, async () =>
      new Response(JSON.stringify({ success: false }), { status: 401 })
    ),
    (error: unknown) => error instanceof AuthenticationError
  );
});

test("rejects an upstream profile without a valid user ID", async () => {
  await assert.rejects(
    () => authenticateRequest("Bearer invalid-profile", config, async () =>
      new Response(JSON.stringify({ success: true, data: { id: "42" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ),
    (error: unknown) => error instanceof AuthenticationError
  );
});

test("fails closed when Hoomi cannot be reached", async () => {
  await assert.rejects(
    () => authenticateRequest("Bearer session-token", config, async () => {
      throw new TypeError("network unavailable");
    }),
    (error: unknown) => error instanceof AuthenticationUnavailableError
  );
});
