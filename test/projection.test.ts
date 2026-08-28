import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  sanitizeMasterData,
  sanitizeMicroAppSearchResults,
  sanitizeMicroAppSummary
} from "../src/features/micro-apps/projection.js";

test("projects micro-app lists and search results without sensitive upstream fields", () => {
  const upstreamApp = {
    id: 1000000001,
    app_name: "Hoomi Demo",
    app_secret: "should-not-be-exposed",
    email: "private@example.com",
    user_id: 42
  };

  assert.deepEqual(sanitizeMicroAppSummary(upstreamApp), {
    id: 1000000001,
    app_name: "Hoomi Demo"
  });
  assert.deepEqual(sanitizeMicroAppSearchResults([upstreamApp]), [
    { id: 1000000001, app_name: "Hoomi Demo" }
  ]);
});

test("projects master data using endpoint-specific fields", () => {
  assert.deepEqual(
    sanitizeMasterData(
      [{ id: 6, permission_key: "wallet", app_secret: "should-not-be-exposed" }],
      "permissions"
    ),
    [{ id: 6, permission_key: "wallet" }]
  );
});
