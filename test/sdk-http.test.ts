import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { MemorySecretHandoffStore } from "../src/secrets/handoff.js";
import { MemoryWriteApprovalStore } from "../src/secrets/write-approval.js";

const config: AppConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 8300,
  mcpPath: "/mcp",
  authMode: "hoomi-session",
  hoomiJwtSecret: "a-secure-test-secret-that-is-long-enough",
  hoomiJwtIssuer: "HOOMI-API",
  hoomiJwtAudience: undefined,
  hoomiApiBaseUrl: "https://apidev.hoomi.social",
  hoomiRequestTimeoutMs: 10_000,
  hoomiMaxResponseBytes: 2_000_000,
  maxToolOutputBytes: 200_000,
  sdkSourceDir: fileURLToPath(new URL("./fixtures/sdk", import.meta.url)),
  sdkRevision: "fixture-sdk-revision",
  sdkSourceDigest: undefined,
  secretHandoffStore: "memory",
  secretHandoffTtlSeconds: 300,
  writeApprovalTtlSeconds: 120,
  secretHandoffPath: "/v1/secret-handoffs",
  writeApprovalPath: "/v1/write-approvals",
  allowedHosts: ["127.0.0.1"],
  allowedOrigins: []
};

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

async function callSdkTool(
  baseUrl: string,
  name: string,
  args: Record<string, unknown>,
  id: number
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })
  });
  assert.equal(response.status, 200);
  return parseMcpResponse(await response.text());
}

test("calls every SDK tool over HTTP without a bearer token", async () => {
  const handoffStore = new MemorySecretHandoffStore();
  const approvalStore = new MemoryWriteApprovalStore();
  const server = await listen(createApp(config, handoffStore, approvalStore));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const status = await callSdkTool(baseUrl, "hoomi_sdk_status", {}, 1);
    const statusResult = status.result as { content: Array<{ text: string }>; isError?: boolean };
    assert.equal(statusResult.isError, undefined);
    const statusPayload = JSON.parse(statusResult.content[0].text) as Record<string, unknown>;
    assert.equal((statusPayload.package as Record<string, unknown>).version, "9.9.9-test");

    const search = await callSdkTool(baseUrl, "hoomi_sdk_search", { query: "export function getHoomi" }, 2);
    const searchResult = search.result as { content: Array<{ text: string }>; isError?: boolean };
    assert.equal(searchResult.isError, undefined);
    assert.equal((JSON.parse(searchResult.content[0].text) as Array<{ path: string }>)[0]?.path, "src/hoomi.ts");

    const source = await callSdkTool(baseUrl, "hoomi_sdk_get_source", { path: "src/hoomi.ts" }, 3);
    const sourceResult = source.result as { content: Array<{ text: string }>; isError?: boolean };
    assert.equal(sourceResult.isError, undefined);
    assert.match((JSON.parse(sourceResult.content[0].text) as { text: string }).text, /getHoomi/);

    const api = await callSdkTool(baseUrl, "hoomi_sdk_get_api", { namespace: "wallet" }, 4);
    const apiResult = api.result as { content: Array<{ text: string }>; isError?: boolean };
    assert.equal(apiResult.isError, undefined);
    assert.match((JSON.parse(apiResult.content[0].text) as { interface: string }).interface, /requestPayment/);

    const guidance = await callSdkTool(baseUrl, "hoomi_sdk_get_guidance", { topic: "wallet" }, 5);
    const guidanceResult = guidance.result as { content: Array<{ text: string }>; isError?: boolean };
    assert.equal(guidanceResult.isError, undefined);
    assert.match((JSON.parse(guidanceResult.content[0].text) as { guidance: string }).guidance, /minor units/);

    const namespaceGuidance = await callSdkTool(
      baseUrl,
      "hoomi_sdk_get_guidance",
      { namespace: "wallet" },
      6
    );
    const namespaceGuidanceResult = namespaceGuidance.result as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    assert.equal(namespaceGuidanceResult.isError, undefined);
    assert.match(
      (JSON.parse(namespaceGuidanceResult.content[0].text) as { interface: string }).interface,
      /requestPayment/
    );

    const example = await callSdkTool(baseUrl, "hoomi_sdk_get_example", { topic: "core" }, 7);
    const exampleResult = example.result as { content: Array<{ text: string }>; isError?: boolean };
    assert.equal(exampleResult.isError, undefined);
    assert.match((JSON.parse(exampleResult.content[0].text) as { text: string }).text, /getHoomi/);
  } finally {
    await close(server);
    await handoffStore.close();
    await approvalStore.close();
  }
});

test("keeps readiness unavailable when the SDK digest does not match", async () => {
  const handoffStore = new MemorySecretHandoffStore();
  const approvalStore = new MemoryWriteApprovalStore();
  const server = await listen(
    createApp({ ...config, sdkSourceDigest: "0".repeat(64) }, handoffStore, approvalStore)
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/readyz`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: "not_ready", service: "hoomi-mcp" });
  } finally {
    await close(server);
    await handoffStore.close();
    await approvalStore.close();
  }
});
