import { strict as assert } from "node:assert";
import { test } from "node:test";

import { HoomiApiClient } from "../src/sdk/hoomi/client.js";
import { BuildsSdk } from "../src/sdk/hoomi/builds.js";

test("creates a micro-app build as multipart form data", async () => {
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  const sdk = new BuildsSdk(
    new HoomiApiClient({
      baseUrl: "https://apidev.hoomi.social",
      sessionToken: "validated-session-token",
      timeoutMs: 10_000,
      maxResponseBytes: 2_000_000,
      fetchImpl: async (input, init) => {
        requestedUrl = new URL(input.toString());
        requestedInit = init;
        return new Response(JSON.stringify({ success: true, data: { id: 1, app_status: "Prepare Submission" } }), {
          status: 201
        });
      }
    })
  );

  const build = await sdk.create(1, 1000000000, {
    appLang: "en-us",
    appVersion: "1.0.0",
    appUrl: "https://cdn.hoomi.social/apps/demo/1.0.0/index.html",
    appPermissions: [1, 6],
    appDomains: ["demo.example.com", "api.demo.example.com"],
    appIpWhitelist: ["1.2.3.4"],
    appPreviews: [{ data: new Uint8Array([1, 2, 3]), filename: "preview.jpg", contentType: "image/jpeg" }]
  });

  assert.deepEqual(build, { id: 1, app_status: "Prepare Submission" });
  assert.equal(requestedUrl?.toString(), "https://apidev.hoomi.social/v2/partners/entity/1/apps/1000000000/builds");
  assert.equal(requestedInit?.method, "POST");
  const form = requestedInit?.body as FormData;
  assert.equal(form.get("app_lang"), "en-us");
  assert.deepEqual(form.getAll("app_permissions"), ["1", "6"]);
  assert.equal(form.get("app_domains"), "demo.example.com, api.demo.example.com");
  assert.equal(form.get("app_previews") instanceof Blob, true);
});

test("gets a micro-app build through the developer platform route", async () => {
  let requestedUrl: URL | undefined;
  const sdk = new BuildsSdk(
    new HoomiApiClient({
      baseUrl: "https://apidev.hoomi.social",
      sessionToken: "validated-session-token",
      timeoutMs: 10_000,
      maxResponseBytes: 2_000_000,
      fetchImpl: async (input) => {
        requestedUrl = new URL(input.toString());
        return new Response(JSON.stringify({ success: true, data: { id: 1, app_status: "Prepare Submission" } }), {
          status: 200
        });
      }
    })
  );

  const build = await sdk.get(1, 1000000000, 1);

  assert.deepEqual(build, { id: 1, app_status: "Prepare Submission" });
  assert.equal(
    requestedUrl?.toString(),
    "https://apidev.hoomi.social/v2/partners/entity/1/apps/1000000000/builds/1"
  );
});

test("updates a micro-app build as multipart form data", async () => {
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  const sdk = new BuildsSdk(
    new HoomiApiClient({
      baseUrl: "https://apidev.hoomi.social",
      sessionToken: "validated-session-token",
      timeoutMs: 10_000,
      maxResponseBytes: 2_000_000,
      fetchImpl: async (input, init) => {
        requestedUrl = new URL(input.toString());
        requestedInit = init;
        return new Response(JSON.stringify({ success: true, data: { id: 1, app_version: "1.0.1" } }), {
          status: 200
        });
      }
    })
  );

  const build = await sdk.update(1, 1000000000, 1, {
    appLang: "en-us",
    appVersion: "1.0.1",
    appUrl: "https://cdn.hoomi.social/apps/demo/1.0.1/index.html",
    appDomains: ["demo.example.com"]
  });

  assert.deepEqual(build, { id: 1, app_version: "1.0.1" });
  assert.equal(
    requestedUrl?.toString(),
    "https://apidev.hoomi.social/v2/partners/entity/1/apps/1000000000/builds/1"
  );
  assert.equal(requestedInit?.method, "PUT");
  const form = requestedInit?.body as FormData;
  assert.equal(form.get("app_version"), "1.0.1");
  assert.equal(form.get("app_domains"), "demo.example.com");
  assert.equal(form.get("app_previews"), null);
});

test("deletes a micro-app build through the developer platform route", async () => {
  let requestedUrl: URL | undefined;
  let requestedMethod: string | undefined;
  const sdk = new BuildsSdk(
    new HoomiApiClient({
      baseUrl: "https://apidev.hoomi.social",
      sessionToken: "validated-session-token",
      timeoutMs: 10_000,
      maxResponseBytes: 2_000_000,
      fetchImpl: async (input, init) => {
        requestedUrl = new URL(input.toString());
        requestedMethod = init?.method;
        return new Response(JSON.stringify({ success: true, message: "Micro app build deleted" }), { status: 200 });
      }
    })
  );

  const response = await sdk.delete(1, 1000000000, 1);

  assert.equal(response.success, true);
  assert.equal(requestedMethod, "DELETE");
  assert.equal(
    requestedUrl?.toString(),
    "https://apidev.hoomi.social/v2/partners/entity/1/apps/1000000000/builds/1"
  );
});

test("lists build submissions through the developer platform route", async () => {
  let requestedUrl: URL | undefined;
  const sdk = new BuildsSdk(
    new HoomiApiClient({
      baseUrl: "https://apidev.hoomi.social",
      sessionToken: "validated-session-token",
      timeoutMs: 10_000,
      maxResponseBytes: 2_000_000,
      fetchImpl: async (input) => {
        requestedUrl = new URL(input.toString());
        return new Response(
          JSON.stringify({
            success: true,
            data: { submissions: [{ id: 3 }], submission_logs: [{ id: 3, activity: "Submission created" }] }
          }),
          { status: 200 }
        );
      }
    })
  );

  const submissions = await sdk.listSubmissions(1, 1000000000, 1);

  assert.deepEqual(submissions, { submissions: [{ id: 3 }], submission_logs: [{ id: 3, activity: "Submission created" }] });
  assert.equal(
    requestedUrl?.toString(),
    "https://apidev.hoomi.social/v2/partners/entity/1/apps/1000000000/builds/1/submissions"
  );
});
