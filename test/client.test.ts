import { strict as assert } from "node:assert";
import { test } from "node:test";

import { HoomiApiClient, HoomiApiError } from "../src/sdk/hoomi/client.js";

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

test("rejects a successful HTTP response with a failed Hoomi envelope", async () => {
  const client = new HoomiApiClient({
    baseUrl: "https://apidev.hoomi.social",
    sessionToken: "validated-session-token",
    timeoutMs: 10_000,
    maxResponseBytes: 2_000_000,
    fetchImpl: async () =>
      new Response(JSON.stringify({ success: false, message: "secret backend detail" }), { status: 200 })
  });

  await assert.rejects(
    () => client.get("/v2/profile"),
    (error: unknown) => {
      assert.ok(error instanceof HoomiApiError);
      assert.equal(error.code, "upstream_request_failed");
      assert.equal(error.message, "Hoomi API rejected the request");
      assert.equal(error.status, 200);
      return true;
    }
  );
});

test("sends JSON POST bodies without retrying or following redirects", async () => {
  let requestedInit: RequestInit | undefined;
  const client = new HoomiApiClient({
    baseUrl: "https://apidev.hoomi.social",
    sessionToken: "validated-session-token",
    timeoutMs: 10_000,
    maxResponseBytes: 2_000_000,
    fetchImpl: async (_input, init) => {
      requestedInit = init;
      return new Response(JSON.stringify({ success: true, data: { id: 1 } }), { status: 201 });
    }
  });

  await client.postJson("/v2/partners/entity/1/apps/2/members", { email: "member@example.com", role_id: 3 });

  assert.equal(requestedInit?.method, "POST");
  assert.equal(requestedInit?.body, JSON.stringify({ email: "member@example.com", role_id: 3 }));
  assert.deepEqual(requestedInit?.headers, {
    Accept: "application/json",
    Authorization: "Bearer validated-session-token",
    "Content-Type": "application/json"
  });
  assert.equal(requestedInit?.redirect, "error");
});

test("supports bodyless POST lifecycle actions", async () => {
  let requestedInit: RequestInit | undefined;
  const client = new HoomiApiClient({
    baseUrl: "https://apidev.hoomi.social",
    sessionToken: "validated-session-token",
    timeoutMs: 10_000,
    maxResponseBytes: 2_000_000,
    fetchImpl: async (_input, init) => {
      requestedInit = init;
      return new Response(JSON.stringify({ success: true, data: { app_status: "Waiting for Review" } }), {
        status: 200
      });
    }
  });

  await client.post("/v2/partners/entity/1/apps/2/builds/3/submit-for-review");

  assert.equal(requestedInit?.method, "POST");
  assert.equal(requestedInit?.body, undefined);
  assert.deepEqual(requestedInit?.headers, {
    Accept: "application/json",
    Authorization: "Bearer validated-session-token"
  });
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

test("rejects an upstream URL with embedded credentials", () => {
  assert.throws(
    () =>
      new HoomiApiClient({
        baseUrl: "https://user:password@apidev.hoomi.social",
        sessionToken: "validated-session-token",
        timeoutMs: 10_000,
        maxResponseBytes: 2_000_000
      }),
    /without credentials/
  );
});

test("propagates caller cancellation to an in-flight upstream request", async () => {
  const requestController = new AbortController();
  const client = new HoomiApiClient({
    baseUrl: "https://apidev.hoomi.social",
    sessionToken: "validated-session-token",
    timeoutMs: 10_000,
    maxResponseBytes: 2_000_000,
    requestSignal: requestController.signal,
    fetchImpl: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted", "AbortError")),
          { once: true }
        );
      })
  });

  const request = client.get("/v2/profile");
  requestController.abort();

  await assert.rejects(
    request,
    (error: unknown) => error instanceof HoomiApiError && error.code === "upstream_cancelled"
  );
});
