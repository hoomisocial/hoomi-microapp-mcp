import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { test } from "node:test";

import { SignJWT } from "jose";

import { createApp } from "../src/app.js";
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
  hoomiApiBaseUrl: "https://apidev.hoomi.social",
  hoomiRequestTimeoutMs: 10_000,
  hoomiMaxResponseBytes: 2_000_000,
  maxToolOutputBytes: 200_000,
  allowedHosts: ["127.0.0.1"],
  allowedOrigins: []
};

async function createToken(): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("HOOMI-API")
    .setSubject("42")
    .setIssuedAt()
    .setExpirationTime("5 minutes")
    .sign(new TextEncoder().encode(secret));
}

function listen(app: ReturnType<typeof createApp>): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function parseMcpResponse(rawBody: string): Record<string, unknown> {
  const dataLine = rawBody.split(/\r?\n/).find((line) => line.startsWith("data: "));
  return JSON.parse(dataLine ? dataLine.slice("data: ".length) : rawBody) as Record<string, unknown>;
}

test("serves health and protects the MCP endpoint", async () => {
  const server = await listen(createApp(config));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const healthResponse = await fetch(`${baseUrl}/healthz`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), { status: "ok", service: "hoomi-mcp" });

    const unauthorizedResponse = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(unauthorizedResponse.status, 401);
    assert.match(unauthorizedResponse.headers.get("www-authenticate") ?? "", /Bearer/);
  } finally {
    await close(server);
  }
});

test("handles a stateless MCP initialize request", async () => {
  const server = await listen(createApp(config));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const token = await createToken();
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "hoomi-mcp-test", version: "0.1.0" }
        }
      })
    });

    assert.equal(response.status, 200);
    const body = parseMcpResponse(await response.text()) as {
      result?: { serverInfo?: { name?: string }; capabilities?: Record<string, unknown> };
    };
    assert.equal(body.result?.serverInfo?.name, "hoomi-mcp");
    assert.deepEqual(body.result?.capabilities, { tools: { listChanged: true } });
  } finally {
    await close(server);
  }
});

test("executes a read-only tool without exposing sensitive upstream profile fields", async () => {
  let authorizationHeader: string | undefined;
  const upstream = createServer((request, response) => {
    authorizationHeader = request.headers.authorization;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        success: true,
        data: {
          id: 42,
          name: "Ada",
          username: "ada",
          imgUrl: null,
          emailVerified: true,
          phoneNumber: "+620000000",
          wallets: [{ address: "wallet-secret" }]
        }
      })
    );
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
  const upstreamAddress = upstream.address();
  assert.ok(upstreamAddress && typeof upstreamAddress !== "string");

  const server = await listen(
    createApp({ ...config, hoomiApiBaseUrl: `http://127.0.0.1:${upstreamAddress.port}` })
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const token = await createToken();
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "hoomi_get_profile", arguments: {} }
      })
    });

    assert.equal(response.status, 200);
    const body = parseMcpResponse(await response.text());
    const result = body.result as { content: Array<{ text: string }> };
    const profile = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.equal(profile.id, 42);
    assert.equal(profile.name, "Ada");
    assert.equal(profile.email_verified, true);
    assert.equal("phoneNumber" in profile, false);
    assert.equal("wallets" in profile, false);
    assert.equal(authorizationHeader, `Bearer ${token}`);
  } finally {
    await close(server);
    await close(upstream);
  }
});
