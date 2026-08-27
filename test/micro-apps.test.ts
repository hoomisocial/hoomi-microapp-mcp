import { strict as assert } from "node:assert";
import { test } from "node:test";

import { HoomiApiClient } from "../src/sdk/hoomi/client.js";
import { MicroAppsSdk } from "../src/sdk/hoomi/micro-apps.js";

test("updates a micro-app with repeated localized fields and language-specific logos", async () => {
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  const sdk = new MicroAppsSdk(
    new HoomiApiClient({
      baseUrl: "https://apidev.hoomi.social",
      sessionToken: "validated-session-token",
      timeoutMs: 10_000,
      maxResponseBytes: 2_000_000,
      fetchImpl: async (input, init) => {
        requestedUrl = new URL(input.toString());
        requestedInit = init;
        return new Response(JSON.stringify({ success: true, data: { id: 1000000000 } }), { status: 200 });
      }
    })
  );

  await sdk.update(1, 1000000000, {
    appType: "HTML5",
    appBundle: "com.hoomi.wallet",
    appDefaultLanguage: "en-us",
    appCategoryId: 1,
    appAgeRatingsId: 1,
    appLanguages: ["id-id", "en-us"],
    appNames: ["Dompet Hoomi", "Hoomi Wallet"],
    appDescriptions: ["Dompet digital", "Digital wallet"],
    appTaglines: ["Untuk semua", "For everyone"],
    localizedLogos: [
      {
        language: "en-us",
        file: { data: new Uint8Array([1, 2, 3]), filename: "logo.jpg", contentType: "image/jpeg" }
      }
    ]
  });

  assert.equal(requestedUrl?.toString(), "https://apidev.hoomi.social/v2/partners/entity/1/apps/1000000000");
  assert.equal(requestedInit?.method, "PUT");
  assert.match(String(requestedInit?.headers && (requestedInit.headers as Record<string, string>).Accept), /application\/json/);
  const form = requestedInit?.body as FormData;
  assert.deepEqual(form.getAll("app_lang"), ["id-id", "en-us"]);
  assert.deepEqual(form.getAll("app_name"), ["Dompet Hoomi", "Hoomi Wallet"]);
  assert.equal(form.get("app_logo_en-us") instanceof Blob, true);
});

test("gets a micro-app through the developer platform route", async () => {
  let requestedUrl: URL | undefined;
  const sdk = new MicroAppsSdk(
    new HoomiApiClient({
      baseUrl: "https://apidev.hoomi.social",
      sessionToken: "validated-session-token",
      timeoutMs: 10_000,
      maxResponseBytes: 2_000_000,
      fetchImpl: async (input) => {
        requestedUrl = new URL(input.toString());
        return new Response(JSON.stringify({ success: true, data: { micro_apps: { id: 1000000000 } } }), {
          status: 200
        });
      }
    })
  );

  const detail = await sdk.get(1, 1000000000);

  assert.deepEqual(detail, { micro_apps: { id: 1000000000 } });
  assert.equal(requestedUrl?.toString(), "https://apidev.hoomi.social/v2/partners/entity/1/apps/1000000000");
});

test("deletes a micro-app through the developer platform route", async () => {
  let requestedUrl: URL | undefined;
  let requestedMethod: string | undefined;
  const sdk = new MicroAppsSdk(
    new HoomiApiClient({
      baseUrl: "https://apidev.hoomi.social",
      sessionToken: "validated-session-token",
      timeoutMs: 10_000,
      maxResponseBytes: 2_000_000,
      fetchImpl: async (input, init) => {
        requestedUrl = new URL(input.toString());
        requestedMethod = init?.method;
        return new Response(JSON.stringify({ success: true, message: "Micro app deleted" }), { status: 200 });
      }
    })
  );

  const response = await sdk.delete(1, 1000000000);

  assert.equal(response.success, true);
  assert.equal(requestedMethod, "DELETE");
  assert.equal(requestedUrl?.toString(), "https://apidev.hoomi.social/v2/partners/entity/1/apps/1000000000");
});

test("lists the authenticated user's micro-app grants for a partner", async () => {
  let requestedUrl: URL | undefined;
  const sdk = new MicroAppsSdk(
    new HoomiApiClient({
      baseUrl: "https://apidev.hoomi.social",
      sessionToken: "validated-session-token",
      timeoutMs: 10_000,
      maxResponseBytes: 2_000_000,
      fetchImpl: async (input) => {
        requestedUrl = new URL(input.toString());
        return new Response(JSON.stringify({ success: true, data: [{ id: 1000000000 }] }), { status: 200 });
      }
    })
  );

  const apps = await sdk.listMyApps(1);

  assert.deepEqual(apps, [{ id: 1000000000 }]);
  assert.equal(requestedUrl?.toString(), "https://apidev.hoomi.social/v2/micro-apps?partner_id=1");
});

test("lists partner apps through the partner workspace route", async () => {
  let requestedUrl: URL | undefined;
  const sdk = new MicroAppsSdk(
    new HoomiApiClient({
      baseUrl: "https://apidev.hoomi.social",
      sessionToken: "validated-session-token",
      timeoutMs: 10_000,
      maxResponseBytes: 2_000_000,
      fetchImpl: async (input) => {
        requestedUrl = new URL(input.toString());
        return new Response(JSON.stringify({ success: true, data: [{ app_id: 1000000000 }] }), { status: 200 });
      }
    })
  );

  const apps = await sdk.listPartnerApps(1);

  assert.deepEqual(apps, [{ app_id: 1000000000 }]);
  assert.equal(requestedUrl?.toString(), "https://apidev.hoomi.social/v2/partners/entity/1/apps");
});

test("refreshes a micro-app secret through the partner workspace route", async () => {
  let requestedUrl: URL | undefined;
  let requestedMethod: string | undefined;
  const sdk = new MicroAppsSdk(
    new HoomiApiClient({
      baseUrl: "https://apidev.hoomi.social",
      sessionToken: "validated-session-token",
      timeoutMs: 10_000,
      maxResponseBytes: 2_000_000,
      fetchImpl: async (input, init) => {
        requestedUrl = new URL(input.toString());
        requestedMethod = init?.method;
        return new Response(
          JSON.stringify({
            success: true,
            data: { app_id: 1000000000, app_secret: "rotated-secret", app_secret_expiry: "2026-09-26T00:00:00Z" }
          }),
          { status: 200 }
        );
      }
    })
  );

  const rotation = await sdk.refreshSecret(1, 1000000000);

  assert.equal(rotation.app_secret, "rotated-secret");
  assert.equal(requestedMethod, "POST");
  assert.equal(
    requestedUrl?.toString(),
    "https://apidev.hoomi.social/v2/partners/entity/1/apps/1000000000/refresh-secret"
  );
});
