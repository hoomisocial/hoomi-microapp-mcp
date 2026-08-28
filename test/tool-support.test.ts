import { strict as assert } from "node:assert";
import { test } from "node:test";

import { serialize, toolFailure } from "../src/mcp/tool-support.js";
import { HoomiApiError } from "../src/sdk/hoomi/client.js";

test("keeps oversized tool output valid JSON and within the byte budget", () => {
  const output = serialize({ message: "é".repeat(2_000) }, 1_024);

  assert.equal(Buffer.byteLength(output, "utf8") <= 1_024, true);
  assert.deepEqual(JSON.parse(output), {
    error: "output_too_large",
    message: "Tool output exceeded the configured size limit",
    max_bytes: 1_024
  });
});

test("redacts credentials from upstream tool errors", () => {
  const result = toolFailure(
    new HoomiApiError(
      "upstream_request_failed",
      "token=secret-value app_secret=app-value access_token=access-value Bearer abc.def password=hunter2",
      400
    ),
    2_000
  );
  const text = result.content[0].text;

  assert.equal(text.includes("secret-value"), false);
  assert.equal(text.includes("abc.def"), false);
  assert.equal(text.includes("hunter2"), false);
  assert.equal(text.includes("app-value"), false);
  assert.equal(text.includes("access-value"), false);
  assert.equal(text.includes("[redacted]"), true);
});
