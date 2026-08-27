import { strict as assert } from "node:assert";
import { test } from "node:test";

import { HoomiApiClient } from "../src/sdk/hoomi/client.js";
import { MembersSdk } from "../src/sdk/hoomi/members.js";

test("adds an app member through the developer platform route", async () => {
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  const sdk = new MembersSdk(
    new HoomiApiClient({
      baseUrl: "https://apidev.hoomi.social",
      sessionToken: "validated-session-token",
      timeoutMs: 10_000,
      maxResponseBytes: 2_000_000,
      fetchImpl: async (input, init) => {
        requestedUrl = new URL(input.toString());
        requestedInit = init;
        return new Response(JSON.stringify({ success: true, data: { member_id: 8, app_id: 1000000000 } }), {
          status: 201
        });
      }
    })
  );

  const member = await sdk.addAppMember(1, 1000000000, { email: "member@example.com", roleId: 3 });

  assert.deepEqual(member, { member_id: 8, app_id: 1000000000 });
  assert.equal(
    requestedUrl?.toString(),
    "https://apidev.hoomi.social/v2/partners/entity/1/apps/1000000000/members"
  );
  assert.equal(requestedInit?.method, "POST");
  assert.equal(requestedInit?.body, JSON.stringify({ email: "member@example.com", role_id: 3 }));
});

test("removes an app member grant through the developer platform route", async () => {
  let requestedUrl: URL | undefined;
  let requestedMethod: string | undefined;
  const sdk = new MembersSdk(
    new HoomiApiClient({
      baseUrl: "https://apidev.hoomi.social",
      sessionToken: "validated-session-token",
      timeoutMs: 10_000,
      maxResponseBytes: 2_000_000,
      fetchImpl: async (input, init) => {
        requestedUrl = new URL(input.toString());
        requestedMethod = init?.method;
        return new Response(JSON.stringify({ success: true, message: "App member removed" }), { status: 200 });
      }
    })
  );

  const response = await sdk.removeAppMember(1, 1000000000, 8);

  assert.equal(response.success, true);
  assert.equal(requestedMethod, "DELETE");
  assert.equal(
    requestedUrl?.toString(),
    "https://apidev.hoomi.social/v2/partners/entity/1/apps/1000000000/members/8"
  );
});

test("updates an app member role through the developer platform route", async () => {
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  const sdk = new MembersSdk(
    new HoomiApiClient({
      baseUrl: "https://apidev.hoomi.social",
      sessionToken: "validated-session-token",
      timeoutMs: 10_000,
      maxResponseBytes: 2_000_000,
      fetchImpl: async (input, init) => {
        requestedUrl = new URL(input.toString());
        requestedInit = init;
        return new Response(JSON.stringify({ success: true, data: { member_id: 8, role_id: 4 } }), { status: 200 });
      }
    })
  );

  const member = await sdk.updateAppMemberRole(1, 1000000000, 8, { roleId: 4 });

  assert.deepEqual(member, { member_id: 8, role_id: 4 });
  assert.equal(requestedUrl?.toString(), "https://apidev.hoomi.social/v2/partners/entity/1/apps/1000000000/members/8");
  assert.equal(requestedInit?.method, "PUT");
  assert.equal(requestedInit?.body, JSON.stringify({ role_id: 4 }));
});
