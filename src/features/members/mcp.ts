import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { HoomiSdk } from "../../sdk/hoomi/index.js";
import { serialize, toolFailure, writeAnnotations } from "../../mcp/tool-support.js";

export function registerMemberTools(server: McpServer, sdk: HoomiSdk, maxToolOutputBytes: number): void {
  server.registerTool(
    "hoomi_add_app_member",
    {
      title: "Add a micro-app member",
      description:
        "Grant an existing Hoomi workspace member access to a micro-app. This changes workspace app access; only call after explicit human confirmation.",
      inputSchema: z.object({
        entity_id: z.number().int().positive().describe("Hoomi partner workspace ID."),
        app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
        email: z.string().trim().email().max(320).describe("Email of an existing member of the workspace."),
        role_id: z
          .number()
          .int()
          .positive()
          .refine((value) => value !== 1, "The workspace owner role cannot be assigned to an app member."),
        confirm: z.literal(true).describe("Must be true only after explicit human confirmation of this grant.")
      }),
      annotations: writeAnnotations
    },
    async ({ entity_id, app_id, email, role_id }) => {
      try {
        const member = await sdk.members.addAppMember(entity_id, app_id, { email, roleId: role_id });
        return {
          content: [
            {
              type: "text" as const,
              text: serialize(
                {
                  member_id: member?.member_id ?? null,
                  app_id: member?.app_id ?? app_id,
                  username: member?.username ?? null,
                  role_id: member?.role_id ?? role_id,
                  role_name: member?.role_name ?? null,
                  created_at: member?.created_at ?? null
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
    "hoomi_remove_app_member",
    {
      title: "Remove an app member",
      description:
        "Revoke one member's access to a Hoomi micro-app. member_id is the app-grant ID. This is destructive and requires explicit human confirmation.",
      inputSchema: z.object({
        entity_id: z.number().int().positive().describe("Hoomi partner workspace ID."),
        app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
        member_id: z.number().int().positive().describe("Hoomi app-member grant ID, not the user ID."),
        confirm: z.literal(true).describe("Must be true only after explicit human confirmation of this revocation.")
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ entity_id, app_id, member_id }) => {
      try {
        const response = await sdk.members.removeAppMember(entity_id, app_id, member_id);
        return {
          content: [
            {
              type: "text" as const,
              text: serialize(
                { removed: true, entity_id, app_id, member_id, message: response.message ?? "App member removed" },
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
