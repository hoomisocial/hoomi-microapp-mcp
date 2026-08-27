import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { HoomiApiClient, HoomiApiError } from "../hoomi/client.js";

interface ApiEnvelope<T> {
  data?: T;
}

interface ProfileResponse {
  id?: number;
  name?: string;
  username?: string;
  imgUrl?: string | null;
  emailVerified?: boolean;
  registration_date?: string;
}

interface WorkspaceResponse {
  id?: number;
  entity_type?: string;
  entity_name?: string;
  country?: string;
  entity_website?: string;
  entity_status?: string;
  my_role?: string;
  created_at?: string;
}

function unwrap<T>(value: unknown): T {
  if (typeof value === "object" && value !== null && "data" in value) {
    return (value as ApiEnvelope<T>).data as T;
  }

  return value as T;
}

function serialize(value: unknown, maxBytes: number): string {
  const text = JSON.stringify(value, null, 2);
  if (text.length <= maxBytes) {
    return text;
  }

  return `${text.slice(0, maxBytes)}\n[output truncated by hoomi-mcp]`;
}

function toolFailure(error: unknown, maxBytes: number) {
  if (error instanceof HoomiApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: serialize(
            {
              error: error.code,
              message: error.message,
              status: error.status
            },
            maxBytes
          )
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

export function registerReadOnlyTools(
  server: McpServer,
  client: HoomiApiClient | undefined,
  maxToolOutputBytes: number
): void {
  server.registerTool(
    "hoomi_get_profile",
    {
      description: "Get the authenticated Hoomi user's basic profile without wallet, phone, or address data.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        const response = await requireClient(client).get<ApiEnvelope<ProfileResponse>>("/v2/profile");
        const profile = unwrap<ProfileResponse>(response);
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
        const response = await requireClient(client).get<ApiEnvelope<WorkspaceResponse[]>>("/v2/partners/entity/me");
        const workspaces = unwrap<WorkspaceResponse[]>(response) ?? [];
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

  const masterDataTools = [
    ["hoomi_list_micro_app_languages", "/v2/micro-apps/languages", "List supported micro-app languages."],
    ["hoomi_list_micro_app_categories", "/v2/micro-apps/categories", "List available micro-app categories."],
    ["hoomi_list_micro_app_countries", "/v2/micro-apps/countries", "List supported micro-app countries."],
    ["hoomi_list_micro_app_permissions", "/v2/micro-apps/permissions", "List available micro-app permissions."],
    [
      "hoomi_list_micro_app_permission_strings",
      "/v2/micro-apps/permissions/strings",
      "List localized micro-app permission names and descriptions."
    ]
  ] as const;

  for (const [name, path, description] of masterDataTools) {
    server.registerTool(
      name,
      { description, inputSchema: z.object({}) },
      async () => {
        try {
          const response = await requireClient(client).get<unknown>(path);
          return {
            content: [{ type: "text" as const, text: serialize(unwrap(response), maxToolOutputBytes) }]
          };
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
        const response = await requireClient(client).get<unknown>("/v2/micro-apps/search", {
          q: query || undefined,
          page
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
    "hoomi_list_partner_apps",
    {
      description: "List micro-apps the authenticated user can access in a Hoomi partner workspace.",
      inputSchema: z.object({
        partner_id: z.number().int().positive().describe("Hoomi partner workspace ID.")
      })
    },
    async ({ partner_id }) => {
      try {
        const response = await requireClient(client).get<unknown>("/v2/micro-apps", {
          partner_id
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
    "hoomi_list_installed_micro_apps",
    {
      description: "List the authenticated user's installed Hoomi micro-apps grouped by category.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        const response = await requireClient(client).get<unknown>("/v2/micro-apps/installed");
        return {
          content: [{ type: "text" as const, text: serialize(unwrap(response), maxToolOutputBytes) }]
        };
      } catch (error) {
        return toolFailure(error, maxToolOutputBytes);
      }
    }
  );

  server.registerTool(
    "hoomi_check_installed_micro_app_permissions",
    {
      description: "Get the authenticated user's current permissions for one installed Hoomi micro-app.",
      inputSchema: z.object({
        app_id: z.number().int().positive().describe("Hoomi micro-app ID.")
      })
    },
    async ({ app_id }) => {
      try {
        const response = await requireClient(client).get<unknown>("/v2/micro-apps/installed/permissions", { app_id });
        return {
          content: [{ type: "text" as const, text: serialize(unwrap(response), maxToolOutputBytes) }]
        };
      } catch (error) {
        return toolFailure(error, maxToolOutputBytes);
      }
    }
  );

  server.registerTool(
    "hoomi_list_pinned_micro_apps",
    {
      description: "List the authenticated user's pinned installed Hoomi micro-apps in pin order.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        const response = await requireClient(client).get<unknown>("/v2/micro-apps/installed/pinned");
        return {
          content: [{ type: "text" as const, text: serialize(unwrap(response), maxToolOutputBytes) }]
        };
      } catch (error) {
        return toolFailure(error, maxToolOutputBytes);
      }
    }
  );

  server.registerTool(
    "hoomi_list_micro_app_reviews",
    {
      description: "List public reviews for a Hoomi micro-app without exposing reviewer email or user ID.",
      inputSchema: z.object({
        app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
        page: z.number().int().min(1).max(10_000).default(1).describe("1-based result page.")
      })
    },
    async ({ app_id, page }) => {
      try {
        const response = await requireClient(client).get<unknown>(`/v2/micro-apps/${app_id}/reviews`, { page });
        const payload = unwrap<unknown>(response);
        if (Array.isArray(payload)) {
          return {
            content: [
              {
                type: "text" as const,
                text: serialize(
                  payload.map((review) => sanitizeReview(review)),
                  maxToolOutputBytes
                )
              }
            ]
          };
        }

        return {
          content: [{ type: "text" as const, text: serialize(sanitizeReviewPage(payload), maxToolOutputBytes) }]
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
        const response = await requireClient(client).get<unknown>(`/v2/partners/entity/${entity_id}/apps`);
        return {
          content: [{ type: "text" as const, text: serialize(unwrap(response), maxToolOutputBytes) }]
        };
      } catch (error) {
        return toolFailure(error, maxToolOutputBytes);
      }
    }
  );
}

function sanitizeReview(value: unknown): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const review = value as Record<string, unknown>;
  return {
    id: review.id ?? null,
    username: review.username ?? null,
    app_lang: review.app_lang ?? null,
    app_version: review.app_version ?? null,
    ratings: review.ratings ?? null,
    reviews: review.reviews ?? null,
    created_at: review.created_at ?? null
  };
}

function sanitizeReviewPage(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }

  const page = value as Record<string, unknown>;
  return {
    ...page,
    data: Array.isArray(page.data) ? page.data.map((review) => sanitizeReview(review)) : page.data
  };
}
