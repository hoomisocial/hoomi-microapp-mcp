import { strict as assert } from "node:assert";
import { test } from "node:test";

import { MemorySecretHandoffStore } from "../src/secrets/handoff.js";
import {
  hashWriteApprovalArguments,
  MemoryWriteApprovalStore,
  normalizeWriteApprovalArguments
} from "../src/secrets/write-approval.js";

test("scopes a secret handoff to the authenticated user and consumes it once", async () => {
  const store = new MemorySecretHandoffStore();
  const handoff = await store.create(42, 1000000001, "one-time-app-secret", 60);

  assert.match(handoff.reference, /^[a-f0-9]{64}$/);
  assert.equal((await store.consume(43, handoff.reference)), null);
  assert.deepEqual(await store.consume(42, handoff.reference), {
    appId: 1000000001,
    appSecret: "one-time-app-secret",
    expiresAt: handoff.expiresAt
  });
  assert.equal((await store.consume(42, handoff.reference)), null);

  await store.close();
});

test("binds a write approval to the user, tool, exact arguments, and one use", async () => {
  const store = new MemoryWriteApprovalStore();
  const argumentsHash = hashWriteApprovalArguments({ app_id: 1000000001, entity_id: 42 });
  const approval = await store.create(42, "hoomi_delete_micro_app", argumentsHash, 60);

  assert.equal(await store.consume(43, "hoomi_delete_micro_app", argumentsHash, approval.reference), false);
  assert.equal(
    await store.consume(42, "hoomi_delete_micro_app", hashWriteApprovalArguments({ entity_id: 42, app_id: 1000000001 }), approval.reference),
    true
  );
  assert.equal(await store.consume(42, "hoomi_delete_micro_app", argumentsHash, approval.reference), false);

  await store.close();
});

test("does not consume an expired write approval", async () => {
  const store = new MemoryWriteApprovalStore();
  const approval = await store.create(42, "hoomi_delete_micro_app", hashWriteApprovalArguments({ app_id: 1 }), 0);

  assert.equal(await store.consume(42, "hoomi_delete_micro_app", hashWriteApprovalArguments({ app_id: 1 }), approval.reference), false);

  await store.close();
});

test("normalizes tool defaults and strips unknown nested upload fields before hashing", () => {
  assert.deepEqual(
    normalizeWriteApprovalArguments("hoomi_create_micro_app", {
      app_logo: {
        filename: " logo.png ",
        content_type: "image/png",
        data_base64: "YQ==",
        app_secret: "should-not-be-hashed"
      }
    }),
    {
      app_allowed_countries: [],
      app_logo: {
        filename: "logo.png",
        content_type: "image/png",
        data_base64: "YQ=="
      }
    }
  );
});
