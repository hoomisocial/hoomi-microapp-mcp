import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { HoomiApiClient, HoomiApiError } from "../hoomi/client.js";

const permissionKeys = [
  "user_info",
  "location",
  "camera",
  "audio",
  "background_job",
  "wallet",
  "iot_devices",
  "pages"
] as const;

const appPermissions = z
  .record(z.string(), z.boolean())
  .refine((permissions) => Object.keys(permissions).every((key) => permissionKeys.includes(key as (typeof permissionKeys)[number])), {
    message: `Only known Hoomi permission keys are allowed: ${permissionKeys.join(", ")}`
  });

interface ApiEnvelope<T> {
  data?: T;
}

function unwrap<T>(value: unknown): T {
  if (typeof value === "object" && value !== null && "data" in value) {
    return (value as ApiEnvelope<T>).data as T;
  }

  return value as T;
}

function serialize(value: unknown, maxBytes: number): string {
  const text = JSON.stringify(value, null, 2);
  return text.length <= maxBytes ? text : `${text.slice(0, maxBytes)}\n[output truncated by hoomi-mcp]`;
}

function toolFailure(error: unknown, maxBytes: number) {
  if (error instanceof HoomiApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: serialize({ error: error.code, message: error.message, status: error.status }, maxBytes)
        }
      ]
    };
  }

  return {
    isError: true,
    content: [{ type: "text" as const, text: "{\"error\":\"internal_tool_error\"}" }]
  };
}

function requireClient(client: HoomiApiClient | undefined): HoomiApiClient {
  if (!client) {
    throw new HoomiApiError("session_required", "A validated Hoomi session is required for this tool");
  }

  return client;
}

function sanitizeBuild(value: unknown): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const build = value as Record<string, unknown>;
  return {
    id: build.id ?? null,
    app_lang: build.app_lang ?? null,
    app_version: build.app_version ?? null,
    app_url: build.app_url ?? null,
    app_previews: build.app_previews ?? [],
    app_callback_url: build.app_callback_url ?? null,
    app_permissions: build.app_permissions ?? [],
    app_domains: build.app_domains ?? [],
    app_ip_whitelist: build.app_ip_whitelist ?? [],
    app_status: build.app_status ?? null,
    submitted_date: build.submitted_date ?? null,
    canceled_date: build.canceled_date ?? null,
    distributed_date: build.distributed_date ?? null,
    created_at: build.created_at ?? null
  };
}

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const;

export function registerWriteTools(
  server: McpServer,
  client: HoomiApiClient | undefined,
  maxToolOutputBytes: number
): void {
  server.registerTool(
    "hoomi_install_micro_app",
    {
      title: "Install a Hoomi micro-app",
      description:
        "Install a published Hoomi micro-app for the authenticated user. This changes the user's installed apps; only call after explicit human confirmation.",
      inputSchema: z.object({
        app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
        app_version: z.string().trim().min(1).max(64).describe("Distributed app version to install."),
        app_permissions: appPermissions.optional().describe("Optional permission toggles; omitted keys default to false."),
        confirm: z.literal(true).describe("Must be true only after explicit human confirmation of this install.")
      }),
      annotations: writeAnnotations
    },
    async ({ app_id, app_version, app_permissions }) => {
      try {
        const response = await requireClient(client).postJson<ApiEnvelope<unknown>>("/v2/micro-apps/installed", {
          app_id,
          app_version,
          ...(app_permissions ? { app_permissions } : {})
        });

        return {
          content: [{ type: "text" as const, text: serialize(unwrap(response), maxToolOutputBytes) }]
        };
      } catch (error) {
        return toolFailure(error, maxToolOutputBytes);
      }
    }
  );

  server.registerTool(
    "hoomi_submit_micro_app_review",
    {
      title: "Submit a Hoomi micro-app review",
      description:
        "Submit or reactivate the authenticated user's review for an installed Hoomi micro-app. This creates user-visible content; only call after explicit human confirmation.",
      inputSchema: z.object({
        app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
        ratings: z.number().int().min(1).max(5).describe("Rating from 1 to 5."),
        reviews: z.string().trim().max(5_000).optional().describe("Optional review text."),
        confirm: z.literal(true).describe("Must be true only after explicit human confirmation of this submission.")
      }),
      annotations: writeAnnotations
    },
    async ({ app_id, ratings, reviews }) => {
      try {
        const response = await requireClient(client).postJson<ApiEnvelope<Record<string, unknown>>>(
          `/v2/micro-apps/${app_id}/reviews`,
          {
            ratings,
            ...(reviews !== undefined ? { reviews } : {})
          }
        );
        const review = unwrap<Record<string, unknown>>(response);
        return {
          content: [
            {
              type: "text" as const,
              text: serialize(
                {
                  id: review?.id ?? null,
                  app_lang: review?.app_lang ?? null,
                  app_version: review?.app_version ?? null,
                  ratings: review?.ratings ?? null,
                  reviews: review?.reviews ?? null,
                  created_at: review?.created_at ?? null
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
    "hoomi_add_micro_app_member",
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
        const response = await requireClient(client).postJson<ApiEnvelope<Record<string, unknown>>>(
          `/v2/partners/entity/${entity_id}/apps/${app_id}/members`,
          { email, role_id }
        );
        const member = unwrap<Record<string, unknown>>(response);
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

  const buildActionTools = [
    [
      "hoomi_submit_build_for_review",
      "Submit a Hoomi micro-app build for review.",
      "submit-for-review"
    ],
    [
      "hoomi_mark_build_ready_to_release",
      "Mark a Hoomi micro-app build ready to release.",
      "ready-to-release"
    ]
  ] as const;

  for (const [name, description, action] of buildActionTools) {
    server.registerTool(
      name,
      {
        title: description,
        description: `${description} This changes the build lifecycle; only call after explicit human confirmation.`,
        inputSchema: z.object({
          entity_id: z.number().int().positive().describe("Hoomi partner workspace ID."),
          app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
          build_id: z.number().int().positive().describe("Hoomi micro-app build ID."),
          confirm: z.literal(true).describe("Must be true only after explicit human confirmation of this action.")
        }),
        annotations: writeAnnotations
      },
      async ({ entity_id, app_id, build_id }) => {
        try {
          const response = await requireClient(client).post<ApiEnvelope<unknown>>(
            `/v2/partners/entity/${entity_id}/apps/${app_id}/builds/${build_id}/${action}`
          );
          return {
            content: [{ type: "text" as const, text: serialize(sanitizeBuild(unwrap(response)), maxToolOutputBytes) }]
          };
        } catch (error) {
          return toolFailure(error, maxToolOutputBytes);
        }
      }
    );
  }
}
