import { strict as assert } from "node:assert";
import { test } from "node:test";

import { MemorySecretHandoffStore } from "../src/secrets/handoff.js";

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
