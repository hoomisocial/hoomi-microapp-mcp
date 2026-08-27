import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { HoomiSdk } from "../../sdk/hoomi/index.js";
import { serialize, toolFailure } from "../../mcp/tool-support.js";

export function registerAccountTools(server: McpServer, sdk: HoomiSdk, maxToolOutputBytes: number): void {
  server.registerTool(
    "hoomi_get_profile",
    {
      description: "Get the authenticated Hoomi user's basic profile without wallet, phone, or address data.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        const profile = await sdk.account.getProfile();
        return {
          content: [
            {
              type: "text" as const,
              text: serialize(
                {
                  id: profile.id ?? null,
                  name: profile.name ?? null,
                  username: profile.username ?? null,
                  avatar: profile.imgUrl ?? null,
                  email_verified: profile.emailVerified ?? false,
                  registration_date: profile.registration_date ?? null
                },
                maxToolOutputBytes
              )
            }
          ]
        };
      } catch (error) {
        return toolFailure(error, maxToolOutputBytes);
      }
    }
  );

  server.registerTool(
    "hoomi_list_workspaces",
    {
      description: "List Hoomi partner workspaces belonging to the authenticated user.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        const workspaces = await sdk.account.listWorkspaces();
        return {
          content: [
            {
              type: "text" as const,
              text: serialize(
                workspaces.map((workspace) => ({
                  id: workspace.id ?? null,
                  type: workspace.entity_type ?? null,
                  name: workspace.entity_name ?? null,
                  country: workspace.country ?? null,
                  website: workspace.entity_website ?? null,
                  status: workspace.entity_status ?? null,
                  role: workspace.my_role ?? null,
                  created_at: workspace.created_at ?? null
                })),
                maxToolOutputBytes
              )
            }
          ]
        };
      } catch (error) {
        return toolFailure(error, maxToolOutputBytes);
      }
    }
  );
}
