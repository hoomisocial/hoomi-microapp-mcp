import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { RedisClientType } from "redis";

import { MemorySecretHandoffStore, RedisSecretHandoffStore } from "../src/secrets/handoff.js";
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

test("binds an encrypted Redis handoff to its storage key", async () => {
  const entries = new Map<string, string>();
  const client = {
    isReady: true,
    isOpen: false,
    set: async (key: string, value: string) => {
      entries.set(key, value);
      return "OK";
    },
    getDel: async (key: string) => {
      const value = entries.get(key) ?? null;
      entries.delete(key);
      return value;
    },
    ping: async () => "PONG",
    close: async () => undefined
  } as unknown as RedisClientType;
  const store = new RedisSecretHandoffStore(client, Buffer.alloc(32, 7));
  const handoff = await store.create(42, 1000000001, "one-time-app-secret", 60);
  const [storedKey, encoded] = [...entries.entries()][0] ?? [];

  assert.ok(storedKey);
  assert.ok(encoded);
  assert.doesNotMatch(encoded, /one-time-app-secret/);
  entries.set(storedKey.replace(":42:", ":43:"), encoded);

  assert.equal(await store.consume(43, handoff.reference), null);
  assert.deepEqual(await store.consume(42, handoff.reference), {
    appId: 1000000001,
    appSecret: "one-time-app-secret",
    expiresAt: handoff.expiresAt
  });
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

test("rejects excessively nested write approval arguments", () => {
  let nested: unknown = "logo.png";
  for (let depth = 0; depth < 25; depth += 1) {
    nested = { nested };
  }

  assert.throws(
    () =>
      normalizeWriteApprovalArguments("hoomi_create_micro_app", {
        app_logo: { filename: nested, content_type: "image/png", data_base64: "YQ==" }
      }),
    /maximum nesting depth/
  );
});
