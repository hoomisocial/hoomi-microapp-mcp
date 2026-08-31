import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { SdkSource, SdkSourceError } from "../src/features/sdk/source.js";

const fixtureDirectory = fileURLToPath(new URL("./fixtures/sdk", import.meta.url));

test("reads the configured SDK snapshot without network or mutation", async () => {
  const source = new SdkSource({
    rootDirectory: fixtureDirectory,
    revision: "fixture-sdk-revision",
    digest: "ddf44b58a122d9377e8d4340fa2964b23ee4025bf4b0bbe458e69a429dacd96e"
  });

  assert.equal(await source.isReady(), true);
  const status = await source.status();
  assert.equal(status.revision, "fixture-sdk-revision");
  assert.equal(status.package.version, "9.9.9-test");
  assert.equal(status.sourceDirectoryConfigured, true);

  const search = await source.search("export function getHoomi", undefined, 10);
  assert.equal(search[0]?.path, "src/hoomi.ts");

  const file = await source.read("src/hoomi.ts");
  assert.match(file.content, /getHoomi/);
});

test("rejects SDK source traversal and unsupported files", async () => {
  const source = new SdkSource({ rootDirectory: fixtureDirectory });

  await assert.rejects(
    () => source.read("../package.json"),
    (error: unknown) => error instanceof SdkSourceError && error.code === "sdk_source_path_invalid"
  );
  await assert.rejects(
    () => source.read("src/secret.txt"),
    (error: unknown) => error instanceof SdkSourceError && error.code === "sdk_source_path_invalid"
  );
  await assert.rejects(
    () => source.search("getHoomi", "../"),
    (error: unknown) => error instanceof SdkSourceError && error.code === "sdk_source_path_invalid"
  );
});

test("rejects an SDK snapshot whose content digest does not match", async () => {
  const source = new SdkSource({ rootDirectory: fixtureDirectory, digest: "0".repeat(64) });

  assert.equal(await source.isReady(), false);
  await assert.rejects(
    () => source.prepare(),
    (error: unknown) => error instanceof SdkSourceError && error.code === "sdk_source_integrity_mismatch"
  );
});
