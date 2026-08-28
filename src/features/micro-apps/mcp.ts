import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { AppConfig } from "../../config.js";
import { HoomiSdk } from "../../sdk/hoomi/index.js";
import { HoomiApiError } from "../../sdk/hoomi/client.js";
import type { MicroApp, MicroAppDetail } from "../../sdk/hoomi/types.js";
import type { AuthenticatedPrincipal } from "../../auth.js";
import type { SecretHandoffStore } from "../../secrets/handoff.js";
import { writeApprovalReferencePattern, type WriteApprovalStore } from "../../secrets/write-approval.js";
import {
  sanitizeMasterData,
  sanitizeMicroApp,
  sanitizeMicroAppDetail,
  sanitizeMicroAppSearchResults,
  sanitizeMicroAppSummary
} from "./projection.js";
import { decodeUpload, uploadContentTypes } from "../shared/upload.js";
import { requireWriteApproval, serialize, toolFailure, writeAnnotations } from "../../mcp/tool-support.js";

export interface SecretHandoffContext {
  config: AppConfig;
  principal: AuthenticatedPrincipal;
  store: SecretHandoffStore;
  approvalStore: WriteApprovalStore;
}

const uploadSchema = z.object({
  filename: z.string().trim().min(1).max(128),
  content_type: z.enum(uploadContentTypes),
  data_base64: z.string().min(1).max(7_000_000)
});

const httpsUrl = z
  .string()
  .url()
  .refine((value) => {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  }, "URL must use HTTPS without embedded credentials");
const countryCodes = z
  .array(z.string().regex(/^[A-Z]{2}$/))
  .max(250)
  .default([])
  .refine((value) => new Set(value).size === value.length, "app_allowed_countries must not contain duplicates");
const approvalReference = z.string().regex(writeApprovalReferencePattern).optional();

function requireMicroApp(value: MicroApp | undefined): MicroApp {
  if (!value || typeof value.id !== "number" || !Number.isSafeInteger(value.id) || value.id <= 0) {
    throw new HoomiApiError("invalid_upstream_response", "Hoomi API returned an invalid micro-app response");
  }

  return value;
}

function requireMicroAppDetail(value: MicroAppDetail | undefined): MicroAppDetail {
  if (!value || typeof value !== "object") {
    throw new HoomiApiError("invalid_upstream_response", "Hoomi API returned an invalid micro-app detail response");
  }

  return value;
}

export function registerMicroAppTools(
  server: McpServer,
  sdk: HoomiSdk,
  maxToolOutputBytes: number,
  handoff: SecretHandoffContext
): void {
  const masterDataTools = [
    [
      "hoomi_list_micro_app_languages",
      () => sdk.microApps.listLanguages(),
      "languages",
      "List supported micro-app languages."
    ],
    [
      "hoomi_list_micro_app_categories",
      () => sdk.microApps.listCategories(),
      "categories",
      "List available micro-app categories."
    ],
    [
      "hoomi_list_micro_app_countries",
      () => sdk.microApps.listCountries(),
      "countries",
      "List supported micro-app countries."
    ],
    [
      "hoomi_list_micro_app_permissions",
      () => sdk.microApps.listPermissions(),
      "permissions",
      "List available micro-app permissions."
    ],
    [
      "hoomi_list_micro_app_permission_strings",
      () => sdk.microApps.listPermissionStrings(),
      "permissionStrings",
      "List localized micro-app permission names and descriptions."
    ]
  ] as const;

  for (const [name, operation, kind, description] of masterDataTools) {
    server.registerTool(
      name,
      { description, inputSchema: z.object({}) },
      async () => {
        try {
          return {
            content: [
              {
                type: "text" as const,
                text: serialize(sanitizeMasterData(await operation(), kind), maxToolOutputBytes)
              }
            ]
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
        return {
          content: [
            {
              type: "text" as const,
              text: serialize(
                sanitizeMicroAppSearchResults(await sdk.microApps.search(query, page)),
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
    "hoomi_list_partner_apps",
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
              text: serialize(
                (await sdk.microApps.listPartnerApps(entity_id)).map(sanitizeMicroAppSummary),
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
    "hoomi_list_my_apps",
    {
      title: "List my micro-apps",
      description: "List micro-apps explicitly granted to the authenticated user in a partner workspace.",
      inputSchema: z.object({
        partner_id: z.number().int().positive().describe("Hoomi partner workspace ID.")
      })
    },
    async ({ partner_id }) => {
      try {
        return {
          content: [
            {
              type: "text" as const,
              text: serialize(
                (await sdk.microApps.listMyApps(partner_id)).map(sanitizeMicroAppSummary),
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
    "hoomi_create_micro_app",
    {
      title: "Create a micro-app",
      description:
        "Create a Hoomi micro-app in a partner workspace. The generated app secret is never returned in the MCP result; use the one-time UI handoff reference instead. The MCP host must obtain a fresh approval receipt after showing the exact arguments to a human.",
      inputSchema: z.object({
        entity_id: z.number().int().positive().describe("Hoomi partner workspace ID."),
        app_type: z.string().trim().min(1).max(50),
        app_name: z.string().trim().min(1).max(160),
        app_bundle: z.string().trim().regex(/^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+$/),
        app_default_language: z.string().trim().regex(/^[a-z]{2}-[a-z]{2}$/),
        app_category_id: z.number().int().positive(),
        app_age_ratings_id: z.number().int().positive(),
        app_description: z.string().trim().max(4000).optional(),
        app_tagline: z.string().trim().max(300).optional(),
        app_privacy_url: httpsUrl.optional(),
        app_tnc_url: httpsUrl.optional(),
        marketing_url: httpsUrl.optional(),
        app_allowed_countries: countryCodes,
        cs_phone: z.string().trim().max(40).optional(),
        cs_email: z.string().trim().email().max(320).optional(),
        app_logo: uploadSchema.optional(),
        approval_reference: approvalReference.describe("Fresh receipt from the Hoomi write-approval endpoint.")
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (input) => {
      const { approval_reference, ...approvedArguments } = input;
      try {
        const userId = handoff.principal.userId;
        if (!userId) {
          throw new HoomiApiError("session_required", "A validated Hoomi session is required for secret delivery");
        }

        await requireWriteApproval(
          handoff.approvalStore,
          handoff.principal,
          "hoomi_create_micro_app",
          approval_reference,
          approvedArguments as Record<string, unknown>
        );
        if (!(await handoff.store.isReady())) {
          throw new HoomiApiError(
            "secret_delivery_unavailable",
            "Secret delivery is temporarily unavailable; no micro-app was created"
          );
        }

        const {
          entity_id, app_type, app_name, app_bundle, app_default_language, app_category_id, app_age_ratings_id,
          app_description, app_tagline, app_privacy_url, app_tnc_url, marketing_url, app_allowed_countries, cs_phone,
          cs_email, app_logo
        } = input;

        const app = await sdk.microApps.create(entity_id, {
          appType: app_type,
          appName: app_name,
          appBundle: app_bundle,
          appDefaultLanguage: app_default_language,
          appCategoryId: app_category_id,
          appAgeRatingsId: app_age_ratings_id,
          appDescription: app_description,
          appTagline: app_tagline,
          appPrivacyUrl: app_privacy_url,
          appTncUrl: app_tnc_url,
          marketingUrl: marketing_url,
          appAllowedCountries: app_allowed_countries,
          csPhone: cs_phone,
          csEmail: cs_email,
          appLogo: app_logo ? decodeUpload(app_logo) : undefined
        });

        const appId = app.id;
        if (typeof appId !== "number" || !Number.isSafeInteger(appId) || appId <= 0 || !app.app_secret) {
          throw new HoomiApiError("invalid_upstream_response", "Hoomi API did not return a deliverable app secret");
        }

        const secretHandoff = await handoff.store.create(
          userId,
          appId,
          app.app_secret,
          handoff.config.secretHandoffTtlSeconds
        );
        return {
          content: [
            {
              type: "text" as const,
              text: serialize(
                {
                  app: sanitizeMicroApp(app),
                  secret_handoff: {
                    reference: secretHandoff.reference,
                    expires_at: secretHandoff.expiresAt,
                    consume_path: `${handoff.config.secretHandoffPath}/${secretHandoff.reference}/consume`
                  }
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
    "hoomi_update_micro_app",
    {
      title: "Update a micro-app",
      description:
        "Update a Hoomi micro-app and its complete set of localized metadata. Publishing requires a distributed build. The MCP host must obtain a fresh approval receipt after showing the exact arguments to a human.",
      inputSchema: z
        .object({
          entity_id: z.number().int().positive().describe("Hoomi partner workspace ID."),
          app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
          app_type: z.string().trim().min(1).max(50),
          app_bundle: z.string().trim().regex(/^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+$/),
          app_default_language: z.string().trim().regex(/^[a-z]{2}-[a-z]{2}$/),
          app_category_id: z.number().int().positive(),
          app_age_ratings_id: z.number().int().positive(),
          app_privacy_url: httpsUrl.optional(),
          app_tnc_url: httpsUrl.optional(),
          marketing_url: httpsUrl.optional(),
          app_allowed_countries: countryCodes,
          cs_phone: z.string().trim().max(40).optional(),
          cs_email: z.string().trim().email().max(320).optional(),
          status: z.enum(["published", "unpublished"]).optional(),
          app_lang: z.array(z.string().trim().regex(/^[a-z]{2}-[a-z]{2}$/)).min(1).max(20),
          app_name: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
          app_description: z.array(z.string().trim().max(4000)).min(1).max(20),
          app_tagline: z.array(z.string().trim().max(300)).min(1).max(20),
          localized_logos: z
            .array(
              z.object({
                language: z.string().trim().regex(/^[a-z]{2}-[a-z]{2}$/),
                file: uploadSchema
              })
            )
            .max(20)
            .default([]),
          approval_reference: approvalReference.describe("Fresh receipt from the Hoomi write-approval endpoint.")
        })
        .superRefine((value, context) => {
          const lengths = [value.app_lang.length, value.app_name.length, value.app_description.length, value.app_tagline.length];
          if (new Set(lengths).size !== 1) {
            context.addIssue({
              code: "custom",
              path: ["app_name"],
              message: "app_lang, app_name, app_description, and app_tagline must have equal lengths"
            });
          }

          if (!value.app_lang.includes(value.app_default_language)) {
            context.addIssue({
              code: "custom",
              path: ["app_default_language"],
              message: "app_default_language must be included in app_lang"
            });
          }
        }),
      annotations: writeAnnotations
    },
    async (input) => {
      const { approval_reference, ...approvedArguments } = input;
      try {
        await requireWriteApproval(
          handoff.approvalStore,
          handoff.principal,
          "hoomi_update_micro_app",
          approval_reference,
          approvedArguments as Record<string, unknown>
        );

        const {
          entity_id, app_id, app_type, app_bundle, app_default_language, app_category_id, app_age_ratings_id,
          app_privacy_url, app_tnc_url, marketing_url, app_allowed_countries, cs_phone, cs_email, status, app_lang,
          app_name, app_description, app_tagline, localized_logos
        } = input;
        const app = requireMicroApp(await sdk.microApps.update(entity_id, app_id, {
          appType: app_type,
          appBundle: app_bundle,
          appDefaultLanguage: app_default_language,
          appCategoryId: app_category_id,
          appAgeRatingsId: app_age_ratings_id,
          appPrivacyUrl: app_privacy_url,
          appTncUrl: app_tnc_url,
          marketingUrl: marketing_url,
          appAllowedCountries: app_allowed_countries,
          csPhone: cs_phone,
          csEmail: cs_email,
          status,
          appLanguages: app_lang,
          appNames: app_name,
          appDescriptions: app_description,
          appTaglines: app_tagline,
          localizedLogos: localized_logos.map((logo) => ({ language: logo.language, file: decodeUpload(logo.file) }))
        }));

        return {
          content: [{ type: "text" as const, text: serialize(sanitizeMicroApp(app), maxToolOutputBytes) }]
        };
      } catch (error) {
        return toolFailure(error, maxToolOutputBytes);
      }
    }
  );

  server.registerTool(
    "hoomi_get_micro_app",
    {
      title: "Get a micro-app",
      description:
        "Get a Hoomi micro-app and its build/review detail. Secrets, demo credentials, reviewer IDs, and reviewer emails are not returned to the model.",
      inputSchema: z.object({
        entity_id: z.number().int().positive().describe("Hoomi partner workspace ID."),
        app_id: z.number().int().positive().describe("Hoomi micro-app ID.")
      })
    },
    async ({ entity_id, app_id }) => {
      try {
        const detail = requireMicroAppDetail(await sdk.microApps.get(entity_id, app_id));
        return {
          content: [{ type: "text" as const, text: serialize(sanitizeMicroAppDetail(detail), maxToolOutputBytes) }]
        };
      } catch (error) {
        return toolFailure(error, maxToolOutputBytes);
      }
    }
  );

  server.registerTool(
    "hoomi_delete_micro_app",
    {
      title: "Delete a micro-app",
      description:
        "Soft-delete a Hoomi micro-app from a partner workspace. This is destructive; the MCP host must obtain a fresh approval receipt after showing the exact arguments to a human.",
      inputSchema: z.object({
        entity_id: z.number().int().positive().describe("Hoomi partner workspace ID."),
        app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
        approval_reference: approvalReference.describe("Fresh receipt from the Hoomi write-approval endpoint.")
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ entity_id, app_id, approval_reference }) => {
      try {
        await requireWriteApproval(
          handoff.approvalStore,
          handoff.principal,
          "hoomi_delete_micro_app",
          approval_reference,
          { entity_id, app_id }
        );
        const response = await sdk.microApps.delete(entity_id, app_id);
        return {
          content: [
            {
              type: "text" as const,
              text: serialize(
                { deleted: true, entity_id, app_id, message: response.message ?? "Micro app deleted" },
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
    "hoomi_refresh_app_secret",
    {
      title: "Refresh a micro-app secret",
      description:
        "Rotate a Hoomi micro-app secret. The new secret is never returned to the model; use the one-time UI handoff reference. The MCP host must obtain a fresh approval receipt after showing the exact arguments to a human.",
      inputSchema: z.object({
        entity_id: z.number().int().positive().describe("Hoomi partner workspace ID."),
        app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
        approval_reference: approvalReference.describe("Fresh receipt from the Hoomi write-approval endpoint.")
      }),
      annotations: writeAnnotations
    },
    async ({ entity_id, app_id, approval_reference }) => {
      try {
        const userId = handoff.principal.userId;
        if (!userId) {
          throw new HoomiApiError("session_required", "A validated Hoomi session is required for secret delivery");
        }

        await requireWriteApproval(
          handoff.approvalStore,
          handoff.principal,
          "hoomi_refresh_app_secret",
          approval_reference,
          { entity_id, app_id }
        );
        if (!(await handoff.store.isReady())) {
          throw new HoomiApiError(
            "secret_delivery_unavailable",
            "Secret delivery is temporarily unavailable; the app secret was not rotated"
          );
        }

        const rotation = await sdk.microApps.refreshSecret(entity_id, app_id);
        const rotatedAppId = rotation.app_id ?? app_id;
        if (!Number.isSafeInteger(rotatedAppId) || rotatedAppId <= 0 || !rotation.app_secret) {
          throw new HoomiApiError("invalid_upstream_response", "Hoomi API did not return a deliverable app secret");
        }

        const secretHandoff = await handoff.store.create(
          userId,
          rotatedAppId,
          rotation.app_secret,
          handoff.config.secretHandoffTtlSeconds
        );
        return {
          content: [
            {
              type: "text" as const,
              text: serialize(
                {
                  app_id: rotatedAppId,
                  app_secret_expiry: rotation.app_secret_expiry ?? null,
                  secret_handoff: {
                    reference: secretHandoff.reference,
                    expires_at: secretHandoff.expiresAt,
                    consume_path: `${handoff.config.secretHandoffPath}/${secretHandoff.reference}/consume`
                  }
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
