import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { test } from "node:test";

import { SignJWT } from "jose";

import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";

const secret = "a-secure-test-secret-that-is-long-enough";
const baseConfig: AppConfig = {
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

test("rejects a write tool call without explicit confirmation", async () => {
  let upstreamCalls = 0;
  const upstream = createServer((_request, response) => {
    upstreamCalls += 1;
    response.statusCode = 500;
    response.end();
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
  const upstreamAddress = upstream.address();
  assert.ok(upstreamAddress && typeof upstreamAddress !== "string");

  const server = await listen(
    createApp({ ...baseConfig, hoomiApiBaseUrl: `http://127.0.0.1:${upstreamAddress.port}` })
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${await createToken()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "hoomi_install_micro_app",
          arguments: { app_id: 1000000001, app_version: "1.0.0", confirm: false }
        }
      })
    });

    assert.equal(response.status, 200);
    const body = parseMcpResponse(await response.text());
    const result = body.result as { isError?: boolean; content?: Array<{ text: string }> };
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /confirm/);
    assert.equal(upstreamCalls, 0);
  } finally {
    await close(server);
    await close(upstream);
  }
});

test("forwards a confirmed install as a single JSON POST", async () => {
  let requestMethod: string | undefined;
  let requestPath: string | undefined;
  let requestBody = "";
  let authorizationHeader: string | undefined;
  const upstream = createServer((request, response) => {
    requestMethod = request.method;
    requestPath = request.url;
    authorizationHeader = request.headers.authorization;
    request.on("data", (chunk: Buffer) => {
      requestBody += chunk.toString("utf8");
    });
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ success: true, data: { id: 9, app_id: 1000000001, app_version: "1.0.0" } }));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
  const upstreamAddress = upstream.address();
  assert.ok(upstreamAddress && typeof upstreamAddress !== "string");

  const server = await listen(
    createApp({ ...baseConfig, hoomiApiBaseUrl: `http://127.0.0.1:${upstreamAddress.port}` })
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const token = await createToken();
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
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
        params: {
          name: "hoomi_install_micro_app",
          arguments: {
            app_id: 1000000001,
            app_version: "1.0.0",
            app_permissions: { camera: true, wallet: false },
            confirm: true
          }
        }
      })
    });

    assert.equal(response.status, 200);
    const body = parseMcpResponse(await response.text());
    const result = body.result as { content: Array<{ text: string }> };
    assert.deepEqual(JSON.parse(result.content[0].text), {
      id: 9,
      app_id: 1000000001,
      app_version: "1.0.0"
    });
    assert.equal(requestMethod, "POST");
    assert.equal(requestPath, "/v2/micro-apps/installed");
    assert.equal(requestBody, JSON.stringify({
      app_id: 1000000001,
      app_version: "1.0.0",
      app_permissions: { camera: true, wallet: false }
    }));
    assert.equal(authorizationHeader, `Bearer ${token}`);
  } finally {
    await close(server);
    await close(upstream);
  }
});
