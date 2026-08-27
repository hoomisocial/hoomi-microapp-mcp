import { McpServer } from "@modelcontextprotocol/server";

import type { AuthenticatedPrincipal } from "./auth.js";
import type { AppConfig } from "./config.js";
import { HoomiApiClient } from "./hoomi/client.js";
import { registerReadOnlyTools } from "./tools/read-only.js";
import { registerWriteTools } from "./tools/write.js";

const SERVER_VERSION = "0.1.0";

export function createMcpServer(principal: AuthenticatedPrincipal, config: AppConfig): McpServer {
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

  registerReadOnlyTools(server, hoomiClient, config.maxToolOutputBytes);
  registerWriteTools(server, hoomiClient, config.maxToolOutputBytes);
  return server;
}
