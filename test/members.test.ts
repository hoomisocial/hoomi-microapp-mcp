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
