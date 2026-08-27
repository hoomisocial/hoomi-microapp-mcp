import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { test } from "node:test";

import { SignJWT } from "jose";

import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { MemorySecretHandoffStore } from "../src/secrets/handoff.js";

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
  secretHandoffStore: "memory",
  secretHandoffTtlSeconds: 300,
  secretHandoffPath: "/v1/secret-handoffs",
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
  const store = new MemorySecretHandoffStore();
  const server = await listen(createApp(config, store));
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
    await store.close();
  }
});

test("handles a stateless MCP initialize request", async () => {
  const store = new MemorySecretHandoffStore();
  const server = await listen(createApp(config, store));
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
    await store.close();
  }
});

test("registers all micro-app and builder tools from the developer platform catalog", async () => {
  const expectedTools = [
    "hoomi_add_app_member",
    "hoomi_remove_app_member",
    "hoomi_update_app_member_role",
    "hoomi_create_micro_app_build",
    "hoomi_create_build_submission",
    "hoomi_get_micro_app_build",
    "hoomi_delete_micro_app_build",
    "hoomi_get_build_submissions",
    "hoomi_mark_build_ready_to_release",
    "hoomi_submit_build_for_review",
    "hoomi_update_micro_app_build",
    "hoomi_create_micro_app",
    "hoomi_update_micro_app",
    "hoomi_delete_micro_app",
    "hoomi_get_micro_app",
    "hoomi_list_my_apps",
    "hoomi_list_partner_apps",
    "hoomi_refresh_app_secret"
  ];
  const store = new MemorySecretHandoffStore();
  const server = await listen(createApp(config, store));
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} })
    });

    assert.equal(response.status, 200);
    const body = parseMcpResponse(await response.text());
    const result = body.result as { tools: Array<{ name: string }> };
    const registeredTools = new Set(result.tools.map((tool) => tool.name));
    for (const tool of expectedTools) {
      assert.equal(registeredTools.has(tool), true, `missing registered tool: ${tool}`);
    }
  } finally {
    await close(server);
    await store.close();
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

  const store = new MemorySecretHandoffStore();
  const server = await listen(
    createApp({ ...config, hoomiApiBaseUrl: `http://127.0.0.1:${upstreamAddress.port}` }, store)
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
    const rawBody = await response.text();
    const body = parseMcpResponse(rawBody);
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
    await store.close();
  }
});

test("creates a micro-app and delivers its secret only through the one-time handoff", async () => {
  let requestedContentType: string | undefined;
  let requestedBody = "";
  const upstream = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requestedContentType = request.headers["content-type"];
      requestedBody = Buffer.concat(chunks).toString("utf8");
      response.statusCode = 201;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          success: true,
          data: {
            id: 1000000001,
            partner_id: 1,
            app_secret: "one-time-app-secret",
            app_secret_expiry: "2026-09-26T00:00:00.000Z",
            app_type: "HTML5",
            app_bundle: "com.hoomi.demo",
            app_default_language: "en-us",
            app_category_id: 4,
            app_age_ratings_id: 1,
            app_name: "Hoomi Demo"
          }
        })
      );
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
  const upstreamAddress = upstream.address();
  assert.ok(upstreamAddress && typeof upstreamAddress !== "string");

  const store = new MemorySecretHandoffStore();
  const server = await listen(
    createApp({ ...config, hoomiApiBaseUrl: `http://127.0.0.1:${upstreamAddress.port}` }, store)
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
        id: 3,
        method: "tools/call",
        params: {
          name: "hoomi_create_micro_app",
          arguments: {
            entity_id: 1,
            app_type: "HTML5",
            app_name: "Hoomi Demo",
            app_bundle: "com.hoomi.demo",
            app_default_language: "en-us",
            app_category_id: 4,
            app_age_ratings_id: 1,
            app_allowed_countries: ["ID"],
            confirm: true
          }
        }
      })
    });

    assert.equal(response.status, 200);
    const body = parseMcpResponse(await response.text());
    const result = body.result as { content: Array<{ text: string }> };
    const created = JSON.parse(result.content[0].text) as {
      app: { id: number };
      secret_handoff: { reference: string; expires_at: string };
    };
    assert.equal(created.app.id, 1000000001);
    assert.match(created.secret_handoff.reference, /^[a-f0-9]{64}$/);
    assert.equal(result.content[0].text.includes("one-time-app-secret"), false);
    assert.match(requestedContentType ?? "", /^multipart\/form-data; boundary=/);
    assert.match(requestedBody, /name="app_name"/);
    assert.match(requestedBody, /Hoomi Demo/);

    const handoffResponse = await fetch(
      `http://127.0.0.1:${address.port}/v1/secret-handoffs/${created.secret_handoff.reference}/consume`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } }
    );
    assert.deepEqual(await handoffResponse.json(), {
      app_id: 1000000001,
      app_secret: "one-time-app-secret",
      expires_at: created.secret_handoff.expires_at
    });
  } finally {
    await close(server);
    await close(upstream);
    await store.close();
  }
});

test("consumes an app secret handoff exactly once for its owning user", async () => {
  const store = new MemorySecretHandoffStore();
  const handoff = await store.create(42, 1000000001, "one-time-app-secret", 60);
  const server = await listen(createApp(config, store));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const token = await createToken();
    const url = `http://127.0.0.1:${address.port}/v1/secret-handoffs/${handoff.reference}/consume`;
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` }
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      app_id: 1000000001,
      app_secret: "one-time-app-secret",
      expires_at: handoff.expiresAt
    });

    const secondResponse = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(secondResponse.status, 404);
  } finally {
    await close(server);
    await store.close();
  }
});
