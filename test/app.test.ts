import { strict as assert } from "node:assert";
import type { Server } from "node:http";
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
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${await createToken()}`,
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
    const rawBody = await response.text();
    const dataLine = rawBody.split(/\r?\n/).find((line) => line.startsWith("data: "));
    const body = JSON.parse(dataLine ? dataLine.slice("data: ".length) : rawBody) as {
      result?: { serverInfo?: { name?: string }; capabilities?: Record<string, unknown> };
    };
    assert.equal(body.result?.serverInfo?.name, "hoomi-mcp");
    assert.deepEqual(body.result?.capabilities, {});
  } finally {
    await close(server);
  }
});
