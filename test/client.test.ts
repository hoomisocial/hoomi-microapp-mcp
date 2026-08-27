import { strict as assert } from "node:assert";
import { test } from "node:test";

import { HoomiApiClient, HoomiApiError } from "../src/hoomi/client.js";

test("sends only the server-owned Hoomi bearer header and bounded query values", async () => {
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;

  const client = new HoomiApiClient({
    baseUrl: "https://apidev.hoomi.social",
    sessionToken: "validated-session-token",
    timeoutMs: 10_000,
    maxResponseBytes: 2_000_000,
    fetchImpl: async (input, init) => {
      requestedUrl = new URL(input.toString());
      requestedInit = init;
      return new Response(JSON.stringify({ success: true, data: [{ id: 1 }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const response = await client.get("/v2/micro-apps/search", { q: "ride", page: 2 });

  assert.deepEqual(response, { success: true, data: [{ id: 1 }] });
  assert.equal(requestedUrl?.toString(), "https://apidev.hoomi.social/v2/micro-apps/search?q=ride&page=2");
  assert.equal(requestedInit?.method, "GET");
  assert.deepEqual(requestedInit?.headers, {
    Accept: "application/json",
    Authorization: "Bearer validated-session-token"
  });
  assert.equal(requestedInit?.redirect, "error");
});

test("maps an upstream 401 without exposing response internals", async () => {
  const client = new HoomiApiClient({
    baseUrl: "https://apidev.hoomi.social",
    sessionToken: "validated-session-token",
    timeoutMs: 10_000,
    maxResponseBytes: 2_000_000,
    fetchImpl: async () => new Response(JSON.stringify({ message: "secret backend detail" }), { status: 401 })
  });

  await assert.rejects(
    () => client.get("/v2/profile"),
    (error: unknown) => {
      assert.ok(error instanceof HoomiApiError);
      assert.equal(error.code, "upstream_unauthorized");
      assert.equal(error.message, "Hoomi API rejected the current session");
      assert.equal(error.status, 401);
      return true;
    }
  );
});

test("rejects routes outside the Hoomi v2 allowlist", async () => {
  const client = new HoomiApiClient({
    baseUrl: "https://apidev.hoomi.social",
    sessionToken: "validated-session-token",
    timeoutMs: 10_000,
    maxResponseBytes: 2_000_000,
    fetchImpl: async () => new Response(null, { status: 200 })
  });

  await assert.rejects(
    () => client.get("/admin/secrets"),
    (error: unknown) => error instanceof HoomiApiError && error.code === "route_not_allowed"
  );
});
