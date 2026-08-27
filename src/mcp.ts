import { McpServer } from "@modelcontextprotocol/server";

import type { AuthenticatedPrincipal } from "./auth.js";

const SERVER_VERSION = "0.1.0";

export function createMcpServer(_principal: AuthenticatedPrincipal): McpServer {
  return new McpServer({
    name: "hoomi-mcp",
    version: SERVER_VERSION
  });
}
