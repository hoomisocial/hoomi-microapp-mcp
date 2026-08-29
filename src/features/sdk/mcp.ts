import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { serialize } from "../../mcp/tool-support.js";
import { SdkSource, SdkSourceError, clipSdkText, interfaceBlock, markdownSection } from "./source.js";

const MAX_SEARCH_RESULTS = 60;

const guidanceHeadings: Record<string, string> = {
  "getting-started": "Quickstart",
  react: "React",
  mock: "Developing without the superapp: the mock host",
  testing: "Testing your micro-app",
  wallet: "Wallet payloads (protocol v1)",
  pages: "Pages: the user's own storefronts (protocol v1)",
  media: "Media: photos, codes and audio (protocol v1)",
  video: "Video: record it in the page, not over the bridge",
  errors: "Error model",
  protocol: "Protocol notes"
};

const examplePaths: Record<string, string> = {
  react: "src/react/index.ts",
  mock: "src/mock/mockHost.ts",
  testing: "src/testing/index.ts",
  core: "src/hoomi.ts",
  app: "examples/react-vite/src/App.tsx"
};

const sdkToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;

function sdkToolFailure(error: unknown, maxToolOutputBytes: number) {
  const payload =
    error instanceof SdkSourceError
      ? { error: error.code, message: error.message }
      : { error: "sdk_source_error", message: "The SDK documentation source is unavailable" };
  return {
    isError: true,
    content: [{ type: "text" as const, text: serialize(payload, maxToolOutputBytes) }]
  };
}

async function safeSdkTool<T>(
  work: () => Promise<T>,
  maxToolOutputBytes: number
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    return { content: [{ type: "text" as const, text: serialize(await work(), maxToolOutputBytes) }] };
  } catch (error) {
    return sdkToolFailure(error, maxToolOutputBytes);
  }
}

export function registerSdkTools(server: McpServer, source: SdkSource, maxToolOutputBytes: number): void {
  server.registerTool(
    "hoomi_sdk_status",
    {
      title: "Hoomi SDK status",
      description:
        "Show the configured Hoomi micro-app SDK source revision, package metadata, entrypoints, and available API namespaces. The source is read-only and this tool does not require a Hoomi session token.",
      inputSchema: z.object({}),
      annotations: sdkToolAnnotations
    },
    async () => safeSdkTool(() => source.status(), maxToolOutputBytes)
  );

  server.registerTool(
    "hoomi_sdk_search",
    {
      title: "Search Hoomi SDK",
      description:
        "Search the configured Hoomi micro-app SDK source, README, examples, tests, and protocol vectors. This read-only tool does not require a Hoomi session token.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(200),
        pathPrefix: z.string().trim().max(200).optional(),
        maxResults: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional()
      }),
      annotations: sdkToolAnnotations
    },
    async ({ query, pathPrefix, maxResults }) =>
      safeSdkTool(() => source.search(query, pathPrefix, maxResults), maxToolOutputBytes)
  );

  server.registerTool(
    "hoomi_sdk_get_source",
    {
      title: "Read Hoomi SDK source",
      description:
        "Read an exact file from the configured Hoomi micro-app SDK snapshot. This read-only tool does not require a Hoomi session token.",
      inputSchema: z.object({
        path: z.string().trim().min(1).max(300),
        lineStart: z.number().int().min(1).optional(),
        lineEnd: z.number().int().min(1).optional()
      }),
      annotations: sdkToolAnnotations
    },
    async ({ path: filePath, lineStart, lineEnd }) =>
      safeSdkTool(async () => {
        const file = await source.read(filePath);
        const lines = file.content.split(/\r?\n/);
        const start = Math.min((lineStart ?? 1) - 1, lines.length);
        const end = Math.min(lineEnd ?? lines.length, lines.length);
        const bounded = clipSdkText(lines.slice(start, Math.max(start, end)).join("\n"));
        return {
          path: file.path,
          lineStart: start + 1,
          lineEnd: Math.max(start, end),
          ...bounded
        };
      }, maxToolOutputBytes)
  );

  server.registerTool(
    "hoomi_sdk_get_api",
    {
      title: "Get Hoomi SDK API reference",
      description:
        "Get the source-backed interface for one Hoomi SDK namespace plus its TypeScript type definitions. This read-only tool does not require a Hoomi session token.",
      inputSchema: z.object({
        namespace: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .describe("Namespace such as lifecycle, user, storage, camera, wallet, pages, or iot")
      }),
      annotations: sdkToolAnnotations
    },
    async ({ namespace }) =>
      safeSdkTool(async () => {
        const normalized = namespace.trim().toLowerCase();
        const interfaceName = `${normalized[0].toUpperCase()}${normalized.slice(1)}Api`;
        const namespaces = await source.read("src/api/namespaces.ts");
        const types = await source.read("src/api/types.ts");
        const api = interfaceBlock(namespaces.content, interfaceName);
        if (!api) {
          throw new SdkSourceError("sdk_source_path_invalid", "Unknown SDK namespace");
        }
        return {
          namespace: normalized,
          interface: api,
          typeDefinitions: clipSdkText(types.content, 18_000).text,
          sourceFiles: ["src/api/namespaces.ts", "src/api/types.ts"]
        };
      }, maxToolOutputBytes)
  );

  server.registerTool(
    "hoomi_sdk_get_guidance",
    {
      title: "Get Hoomi SDK implementation guidance",
      description:
        "Return a concise, source-backed recipe for using the Hoomi micro-app SDK. This read-only tool does not require a Hoomi session token.",
      inputSchema: z.object({
        topic: z
          .string()
          .trim()
          .max(80)
          .optional()
          .describe("getting-started, react, mock, testing, wallet, pages, media, video, errors, or protocol"),
        namespace: z.string().trim().max(40).optional()
      }),
      annotations: sdkToolAnnotations
    },
    async ({ topic, namespace }) =>
      safeSdkTool(async () => {
        const metadata = await source.packageMetadata();
        if (namespace) {
          const api = await source.read("src/api/namespaces.ts");
          const types = await source.read("src/api/types.ts");
          const normalized = namespace.trim().toLowerCase();
          const interfaceName = `${normalized[0].toUpperCase()}${normalized.slice(1)}Api`;
          const apiBlock = interfaceBlock(api.content, interfaceName);
          if (!apiBlock) {
            throw new SdkSourceError("sdk_source_path_invalid", "Unknown SDK namespace");
          }
          return {
            package: typeof metadata.name === "string" ? metadata.name : null,
            packageVersion: typeof metadata.version === "string" ? metadata.version : null,
            canonicalImport: typeof metadata.name === "string" ? metadata.name : null,
            namespace: normalized,
            interface: apiBlock,
            typeDefinitions: clipSdkText(types.content, 18_000).text,
            rule: "Do not invent bridge methods or payload fields; use the exact interface and types above."
          };
        }

        const selectedTopic = (topic || "getting-started").trim().toLowerCase();
        const heading = guidanceHeadings[selectedTopic];
        if (!heading) {
          throw new SdkSourceError("sdk_source_path_invalid", "Unknown SDK guidance topic");
        }
        const readme = await source.read("README.md");
        const section = markdownSection(readme.content, heading);
        if (!section) {
          throw new SdkSourceError("sdk_source_file_unavailable", "SDK guidance topic is unavailable");
        }
        return {
          package: typeof metadata.name === "string" ? metadata.name : null,
          packageVersion: typeof metadata.version === "string" ? metadata.version : null,
          canonicalImport: typeof metadata.name === "string" ? metadata.name : null,
          topic: selectedTopic,
          guidance: clipSdkText(section).text,
          authoritativeFiles: ["README.md", "src/api/namespaces.ts", "src/api/types.ts", "CLAUDE.md"],
          rule: "The SDK is a WebView bridge. Use it from the micro-app browser page, not from a backend or Node server."
        };
      }, maxToolOutputBytes)
  );

  server.registerTool(
    "hoomi_sdk_get_example",
    {
      title: "Get Hoomi SDK example",
      description:
        "Read a canonical Hoomi SDK example from the configured source snapshot. This read-only tool does not require a Hoomi session token.",
      inputSchema: z.object({
        topic: z.string().trim().max(80).optional().describe("react, mock, testing, core, or app"),
        path: z.string().trim().max(300).optional()
      }),
      annotations: sdkToolAnnotations
    },
    async ({ topic, path: requestedPath }) =>
      safeSdkTool(async () => {
        const filePath = requestedPath || examplePaths[(topic || "app").trim().toLowerCase()];
        if (!filePath) {
          throw new SdkSourceError("sdk_source_path_invalid", "Unknown SDK example topic");
        }
        const file = await source.read(filePath);
        return { path: file.path, ...clipSdkText(file.content) };
      }, maxToolOutputBytes)
  );
}
