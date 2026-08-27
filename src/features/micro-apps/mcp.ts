import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { AppConfig } from "../../config.js";
import { HoomiSdk } from "../../sdk/hoomi/index.js";
import { HoomiApiError } from "../../sdk/hoomi/client.js";
import type { AuthenticatedPrincipal } from "../../auth.js";
import type { SecretHandoffStore } from "../../secrets/handoff.js";
import { sanitizeMicroApp, sanitizeMicroAppDetail } from "./projection.js";
import { decodeUpload, uploadContentTypes } from "../shared/upload.js";
import { serialize, toolFailure, writeAnnotations } from "../../mcp/tool-support.js";

export interface SecretHandoffContext {
  config: AppConfig;
  principal: AuthenticatedPrincipal;
  store: SecretHandoffStore;
}

const uploadSchema = z.object({
  filename: z.string().trim().min(1).max(128),
  content_type: z.enum(uploadContentTypes),
  data_base64: z.string().min(1).max(7_000_000)
});

const httpsUrl = z.string().url().refine((value) => /^https?:$/.test(new URL(value).protocol), "URL must use HTTP(S)");

export function registerMicroAppTools(
  server: McpServer,
  sdk: HoomiSdk,
  maxToolOutputBytes: number,
  handoff: SecretHandoffContext
): void {
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

  server.registerTool(
    "hoomi_create_micro_app",
    {
      title: "Create a micro-app",
      description:
        "Create a Hoomi micro-app in a partner workspace. The generated app secret is never returned in the MCP result; use the one-time UI handoff reference instead. Only call after explicit human confirmation.",
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
        app_allowed_countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(250).default([]),
        cs_phone: z.string().trim().max(40).optional(),
        cs_email: z.string().trim().email().max(320).optional(),
        app_logo: uploadSchema.optional(),
        confirm: z.literal(true).describe("Must be true only after explicit human confirmation of this creation.")
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ entity_id, app_type, app_name, app_bundle, app_default_language, app_category_id, app_age_ratings_id,
      app_description, app_tagline, app_privacy_url, app_tnc_url, marketing_url, app_allowed_countries, cs_phone,
      cs_email, app_logo }) => {
      try {
        if (!handoff.principal.userId) {
          throw new HoomiApiError("session_required", "A validated Hoomi session is required for secret delivery");
        }

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

        if (!app.id || !app.app_secret) {
          throw new HoomiApiError("invalid_upstream_response", "Hoomi API did not return a deliverable app secret");
        }

        const secretHandoff = await handoff.store.create(
          handoff.principal.userId,
          app.id,
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
        "Update a Hoomi micro-app and its complete set of localized metadata. Publishing requires a distributed build; only call after explicit human confirmation.",
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
          app_allowed_countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(250).default([]),
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
          confirm: z.literal(true).describe("Must be true only after explicit human confirmation of this update.")
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
    async ({ entity_id, app_id, app_type, app_bundle, app_default_language, app_category_id, app_age_ratings_id,
      app_privacy_url, app_tnc_url, marketing_url, app_allowed_countries, cs_phone, cs_email, status, app_lang,
      app_name, app_description, app_tagline, localized_logos }) => {
      try {
        const app = await sdk.microApps.update(entity_id, app_id, {
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
        });

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
        const detail = await sdk.microApps.get(entity_id, app_id);
        return {
          content: [{ type: "text" as const, text: serialize(sanitizeMicroAppDetail(detail), maxToolOutputBytes) }]
        };
      } catch (error) {
        return toolFailure(error, maxToolOutputBytes);
      }
    }
  );
}
