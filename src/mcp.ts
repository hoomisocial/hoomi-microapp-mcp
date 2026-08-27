import { McpServer } from "@modelcontextprotocol/server";

import type { AuthenticatedPrincipal } from "./auth.js";
import type { AppConfig } from "./config.js";
import { registerAccountTools } from "./features/account/mcp.js";
import { registerBuildTools } from "./features/builds/mcp.js";
import { registerMemberTools } from "./features/members/mcp.js";
import { registerMicroAppTools } from "./features/micro-apps/mcp.js";
import type { SecretHandoffStore } from "./secrets/handoff.js";
import { HoomiApiClient } from "./sdk/hoomi/client.js";
import { HoomiSdk } from "./sdk/hoomi/index.js";

const SERVER_VERSION = "0.1.0";

export function createMcpServer(
  principal: AuthenticatedPrincipal,
  config: AppConfig,
  secretHandoffStore: SecretHandoffStore
): McpServer {
  const server = new McpServer({
    name: "hoomi-mcp",
    version: SERVER_VERSION
  });

  const hoomiClient = principal.sessionToken
    ? new HoomiApiClient({
        baseUrl: config.hoomiApiBaseUrl,
        sessionToken: principal.sessionToken,
        timeoutMs: config.hoomiRequestTimeoutMs,
        maxResponseBytes: config.hoomiMaxResponseBytes
      })
    : undefined;

  const sdk = new HoomiSdk(hoomiClient);
  registerAccountTools(server, sdk, config.maxToolOutputBytes);
  registerMicroAppTools(server, sdk, config.maxToolOutputBytes, {
    config,
    principal,
    store: secretHandoffStore
  });
  registerMemberTools(server, sdk, config.maxToolOutputBytes);
  registerBuildTools(server, sdk, config.maxToolOutputBytes);
  return server;
}
