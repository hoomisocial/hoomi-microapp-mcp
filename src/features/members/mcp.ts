import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { HoomiSdk } from "../../sdk/hoomi/index.js";
import { HoomiApiError } from "../../sdk/hoomi/client.js";
import type { AppMember } from "../../sdk/hoomi/types.js";
import { writeApprovalReferencePattern, type WriteApprovalStore } from "../../secrets/write-approval.js";
import { requireWriteApproval, serialize, toolFailure, writeAnnotations } from "../../mcp/tool-support.js";
import type { AuthenticatedPrincipal } from "../../auth.js";

const approvalReference = z.string().regex(writeApprovalReferencePattern).optional();

function requireAppMember(value: AppMember | undefined): AppMember {
  if (
    !value ||
    typeof value.member_id !== "number" ||
    !Number.isSafeInteger(value.member_id) ||
    value.member_id <= 0
  ) {
    throw new HoomiApiError("invalid_upstream_response", "Hoomi API returned an invalid app-member response");
  }

  return value;
}

export function registerMemberTools(
  server: McpServer,
  sdk: HoomiSdk,
  maxToolOutputBytes: number,
  principal: AuthenticatedPrincipal,
  approvalStore: WriteApprovalStore
): void {
  server.registerTool(
    "hoomi_add_app_member",
    {
      title: "Add a micro-app member",
      description:
        "Grant an existing Hoomi workspace member access to a micro-app. The MCP host must obtain a fresh approval receipt after showing the exact arguments to a human.",
      inputSchema: z.object({
        entity_id: z.number().int().positive().describe("Hoomi partner workspace ID."),
        app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
        email: z.string().trim().email().max(320).describe("Email of an existing member of the workspace."),
        role_id: z
          .number()
          .int()
          .positive()
          .refine((value) => value !== 1, "The workspace owner role cannot be assigned to an app member."),
        approval_reference: approvalReference.describe("Fresh receipt from the Hoomi write-approval endpoint.")
      }),
      annotations: writeAnnotations
    },
    async ({ entity_id, app_id, email, role_id, approval_reference }) => {
      try {
        await requireWriteApproval(approvalStore, principal, "hoomi_add_app_member", approval_reference, {
          entity_id,
          app_id,
          email,
          role_id
        });
        const member = requireAppMember(await sdk.members.addAppMember(entity_id, app_id, { email, roleId: role_id }));
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
        "Revoke one member's access to a Hoomi micro-app. member_id is the app-grant ID. This is destructive; the MCP host must obtain a fresh approval receipt after showing the exact arguments to a human.",
      inputSchema: z.object({
        entity_id: z.number().int().positive().describe("Hoomi partner workspace ID."),
        app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
        member_id: z.number().int().positive().describe("Hoomi app-member grant ID, not the user ID."),
        approval_reference: approvalReference.describe("Fresh receipt from the Hoomi write-approval endpoint.")
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ entity_id, app_id, member_id, approval_reference }) => {
      try {
        await requireWriteApproval(approvalStore, principal, "hoomi_remove_app_member", approval_reference, {
          entity_id,
          app_id,
          member_id
        });
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

  server.registerTool(
    "hoomi_update_app_member_role",
    {
      title: "Update an app member role",
      description:
        "Change the app-level role for an existing Hoomi micro-app member. The workspace owner role cannot be assigned; the MCP host must obtain a fresh approval receipt after showing the exact arguments to a human.",
      inputSchema: z.object({
        entity_id: z.number().int().positive().describe("Hoomi partner workspace ID."),
        app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
        member_id: z.number().int().positive().describe("Hoomi app-member grant ID, not the user ID."),
        role_id: z
          .number()
          .int()
          .positive()
          .refine((value) => value !== 1, "The workspace owner role cannot be assigned to an app member."),
        approval_reference: approvalReference.describe("Fresh receipt from the Hoomi write-approval endpoint.")
      }),
      annotations: writeAnnotations
    },
    async ({ entity_id, app_id, member_id, role_id, approval_reference }) => {
      try {
        await requireWriteApproval(approvalStore, principal, "hoomi_update_app_member_role", approval_reference, {
          entity_id,
          app_id,
          member_id,
          role_id
        });
        const member = requireAppMember(
          await sdk.members.updateAppMemberRole(entity_id, app_id, member_id, { roleId: role_id })
        );
        return {
          content: [
            {
              type: "text" as const,
              text: serialize(
                {
                  member_id: member?.member_id ?? member_id,
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
}
