import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { HoomiSdk } from "../../sdk/hoomi/index.js";
import { serialize, toolFailure } from "../../mcp/tool-support.js";

export function registerMicroAppTools(server: McpServer, sdk: HoomiSdk, maxToolOutputBytes: number): void {
  const masterDataTools = [
    ["hoomi_list_micro_app_languages", sdk.microApps.listLanguages, "List supported micro-app languages."],
    ["hoomi_list_micro_app_categories", sdk.microApps.listCategories, "List available micro-app categories."],
    ["hoomi_list_micro_app_countries", sdk.microApps.listCountries, "List supported micro-app countries."],
    ["hoomi_list_micro_app_permissions", sdk.microApps.listPermissions, "List available micro-app permissions."],
    [
      "hoomi_list_micro_app_permission_strings",
      sdk.microApps.listPermissionStrings,
      "List localized micro-app permission names and descriptions."
    ]
  ] as const;

  for (const [name, operation, description] of masterDataTools) {
    server.registerTool(
      name,
      { description, inputSchema: z.object({}) },
      async () => {
        try {
          return { content: [{ type: "text" as const, text: serialize(await operation(), maxToolOutputBytes) }] };
        } catch (error) {
          return toolFailure(error, maxToolOutputBytes);
        }
      }
    );
  }

  server.registerTool(
    "hoomi_search_micro_apps",
    {
      description: "Search published and distributed Hoomi micro-apps.",
      inputSchema: z.object({
        query: z.string().trim().max(100).optional().describe("Optional substring to match against app text."),
        page: z.number().int().min(1).max(10_000).default(1).describe("1-based result page.")
      })
    },
    async ({ query, page }) => {
      try {
        return {
          content: [{ type: "text" as const, text: serialize(await sdk.microApps.search(query, page), maxToolOutputBytes) }]
        };
      } catch (error) {
        return toolFailure(error, maxToolOutputBytes);
      }
    }
  );

  server.registerTool(
    "hoomi_list_workspace_apps",
    {
      description: "List micro-apps in a Hoomi partner workspace where the authenticated user is a member.",
      inputSchema: z.object({
        entity_id: z.number().int().positive().describe("Hoomi partner workspace ID.")
      })
    },
    async ({ entity_id }) => {
      try {
        return {
          content: [
            {
              type: "text" as const,
              text: serialize(await sdk.microApps.listWorkspaceApps(entity_id), maxToolOutputBytes)
            }
          ]
        };
      } catch (error) {
        return toolFailure(error, maxToolOutputBytes);
      }
    }
  );
}
