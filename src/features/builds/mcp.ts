import { isIP } from "node:net";

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { AuthenticatedPrincipal } from "../../auth.js";
import { HoomiApiError } from "../../sdk/hoomi/client.js";
import { HoomiSdk } from "../../sdk/hoomi/index.js";
import type { Build, BuildSubmission } from "../../sdk/hoomi/types.js";
import { writeApprovalReferencePattern, type WriteApprovalStore } from "../../secrets/write-approval.js";
import { requireWriteApproval, serialize, toolFailure, writeAnnotations } from "../../mcp/tool-support.js";
import { decodeUpload, uploadContentTypes } from "../shared/upload.js";
import { sanitizeBuild, sanitizeBuildSubmissions, sanitizeSubmission } from "./projection.js";

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
const approvalReference = z.string().regex(writeApprovalReferencePattern).optional();

function requireBuild(value: Build | undefined): Build {
  if (!value || typeof value.id !== "number" || !Number.isSafeInteger(value.id) || value.id <= 0) {
    throw new HoomiApiError("invalid_upstream_response", "Hoomi API returned an invalid build response");
  }

  return value;
}

function requireSubmission(value: BuildSubmission | undefined): BuildSubmission {
  if (!value || typeof value.id !== "number" || !Number.isSafeInteger(value.id) || value.id <= 0) {
    throw new HoomiApiError("invalid_upstream_response", "Hoomi API returned an invalid submission response");
  }

  return value;
}

export function registerBuildTools(
  server: McpServer,
  sdk: HoomiSdk,
  maxToolOutputBytes: number,
  principal: AuthenticatedPrincipal,
  approvalStore: WriteApprovalStore
): void {
  server.registerTool(
    "hoomi_get_build_submissions",
    {
      title: "Get build submissions",
      description: "Get review submissions and activity logs for a Hoomi micro-app build without reviewer IDs or emails.",
      inputSchema: z.object({
        entity_id: z.number().int().positive().describe("Hoomi partner workspace ID."),
        app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
        build_id: z.number().int().positive().describe("Hoomi micro-app build ID.")
      })
    },
    async ({ entity_id, app_id, build_id }) => {
      try {
        const submissions = await sdk.builds.listSubmissions(entity_id, app_id, build_id);
        return {
          content: [{ type: "text" as const, text: serialize(sanitizeBuildSubmissions(submissions), maxToolOutputBytes) }]
        };
      } catch (error) {
        return toolFailure(error, maxToolOutputBytes);
      }
    }
  );

  server.registerTool(
    "hoomi_create_build_submission",
    {
      title: "Create a build submission",
      description:
        "Create a review submission for a Hoomi micro-app build. Partner members may submit an optional set of review images; the MCP host must obtain a fresh approval receipt after showing the exact arguments to a human.",
      inputSchema: z.object({
        entity_id: z.number().int().positive().describe("Hoomi partner workspace ID."),
        app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
        build_id: z.number().int().positive().describe("Hoomi micro-app build ID."),
        app_review: z.string().trim().min(1).max(5_000).describe("Message for the Hoomi review team."),
        review_files: z.array(uploadSchema).max(10).default([]),
        approval_reference: approvalReference.describe("Fresh receipt from the Hoomi write-approval endpoint.")
      }),
      annotations: writeAnnotations
    },
    async ({ entity_id, app_id, build_id, app_review, review_files, approval_reference }) => {
      try {
        await requireWriteApproval(approvalStore, principal, "hoomi_create_build_submission", approval_reference, {
          entity_id,
          app_id,
          build_id,
          app_review,
          review_files
        });
        const submission = requireSubmission(await sdk.builds.createSubmission(entity_id, app_id, build_id, {
          appReview: app_review,
          reviewFiles: review_files.map(decodeUpload)
        }));
        return {
          content: [{ type: "text" as const, text: serialize(sanitizeSubmission(submission), maxToolOutputBytes) }]
        };
      } catch (error) {
        return toolFailure(error, maxToolOutputBytes);
      }
    }
  );

  server.registerTool(
    "hoomi_get_micro_app_build",
    {
      title: "Get a micro-app build",
      description: "Get a Hoomi micro-app build without demo credentials.",
      inputSchema: z.object({
        entity_id: z.number().int().positive().describe("Hoomi partner workspace ID."),
        app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
        build_id: z.number().int().positive().describe("Hoomi micro-app build ID.")
      })
    },
    async ({ entity_id, app_id, build_id }) => {
      try {
        const build = requireBuild(await sdk.builds.get(entity_id, app_id, build_id));
        return { content: [{ type: "text" as const, text: serialize(sanitizeBuild(build), maxToolOutputBytes) }] };
      } catch (error) {
        return toolFailure(error, maxToolOutputBytes);
      }
    }
  );

  server.registerTool(
    "hoomi_create_micro_app_build",
    {
      title: "Create a micro-app build",
      description:
        "Create a Hoomi micro-app build with optional preview images. Demo passwords are intentionally not accepted by the MCP tool; the MCP host must obtain a fresh approval receipt after showing the exact arguments to a human.",
      inputSchema: z.object({
        entity_id: z.number().int().positive().describe("Hoomi partner workspace ID."),
        app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
        app_lang: z.string().trim().regex(/^[a-z]{2}-[a-z]{2}$/),
        app_version: z.string().trim().min(1).max(80),
        app_url: httpsUrl,
        app_callback_url: httpsUrl.optional(),
        app_permissions: z.array(z.number().int().positive()).max(50).default([]),
        app_domains: z.array(z.string().trim().min(1).max(253)).max(50).default([]),
        app_ip_whitelist: z
          .array(z.string().trim().max(253).refine((value) => isIP(value) !== 0, "Value must be an IP address"))
          .max(50)
          .default([]),
        app_demo_email: z.string().trim().email().max(320).optional(),
        app_previews: z.array(uploadSchema).max(10).default([]),
        approval_reference: approvalReference.describe("Fresh receipt from the Hoomi write-approval endpoint.")
      }),
      annotations: writeAnnotations
    },
    async ({ entity_id, app_id, app_lang, app_version, app_url, app_callback_url, app_permissions, app_domains,
      app_ip_whitelist, app_demo_email, app_previews, approval_reference }) => {
      try {
        await requireWriteApproval(approvalStore, principal, "hoomi_create_micro_app_build", approval_reference, {
          entity_id,
          app_id,
          app_lang,
          app_version,
          app_url,
          app_callback_url,
          app_permissions,
          app_domains,
          app_ip_whitelist,
          app_demo_email,
          app_previews
        });
        const build = requireBuild(await sdk.builds.create(entity_id, app_id, {
          appLang: app_lang,
          appVersion: app_version,
          appUrl: app_url,
          appCallbackUrl: app_callback_url,
          appPermissions: app_permissions,
          appDomains: app_domains,
          appIpWhitelist: app_ip_whitelist,
          appDemoEmail: app_demo_email,
          appPreviews: app_previews.map(decodeUpload)
        }));
        return { content: [{ type: "text" as const, text: serialize(sanitizeBuild(build), maxToolOutputBytes) }] };
      } catch (error) {
        return toolFailure(error, maxToolOutputBytes);
      }
    }
  );

  server.registerTool(
    "hoomi_update_micro_app_build",
    {
      title: "Update a micro-app build",
      description:
        "Update a Hoomi micro-app build. Existing preview images are retained because this endpoint does not upload previews; demo passwords are intentionally not accepted by the MCP tool. The MCP host must obtain a fresh approval receipt after showing the exact arguments to a human.",
      inputSchema: z.object({
        entity_id: z.number().int().positive().describe("Hoomi partner workspace ID."),
        app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
        build_id: z.number().int().positive().describe("Hoomi micro-app build ID."),
        app_lang: z.string().trim().regex(/^[a-z]{2}-[a-z]{2}$/),
        app_version: z.string().trim().min(1).max(80),
        app_url: httpsUrl,
        app_callback_url: httpsUrl.optional(),
        app_permissions: z.array(z.number().int().positive()).max(50).default([]),
        app_domains: z.array(z.string().trim().min(1).max(253)).max(50).default([]),
        app_ip_whitelist: z
          .array(z.string().trim().max(253).refine((value) => isIP(value) !== 0, "Value must be an IP address"))
          .max(50)
          .default([]),
        app_demo_email: z.string().trim().email().max(320).optional(),
        approval_reference: approvalReference.describe("Fresh receipt from the Hoomi write-approval endpoint.")
      }),
      annotations: writeAnnotations
    },
    async ({ entity_id, app_id, build_id, app_lang, app_version, app_url, app_callback_url, app_permissions,
      app_domains, app_ip_whitelist, app_demo_email, approval_reference }) => {
      try {
        await requireWriteApproval(approvalStore, principal, "hoomi_update_micro_app_build", approval_reference, {
          entity_id,
          app_id,
          build_id,
          app_lang,
          app_version,
          app_url,
          app_callback_url,
          app_permissions,
          app_domains,
          app_ip_whitelist,
          app_demo_email
        });
        const build = requireBuild(await sdk.builds.update(entity_id, app_id, build_id, {
          appLang: app_lang,
          appVersion: app_version,
          appUrl: app_url,
          appCallbackUrl: app_callback_url,
          appPermissions: app_permissions,
          appDomains: app_domains,
          appIpWhitelist: app_ip_whitelist,
          appDemoEmail: app_demo_email
        }));
        return { content: [{ type: "text" as const, text: serialize(sanitizeBuild(build), maxToolOutputBytes) }] };
      } catch (error) {
        return toolFailure(error, maxToolOutputBytes);
      }
    }
  );

  server.registerTool(
    "hoomi_delete_micro_app_build",
    {
      title: "Delete a micro-app build",
      description:
        "Soft-delete a Hoomi micro-app build. This is destructive; the MCP host must obtain a fresh approval receipt after showing the exact arguments to a human.",
      inputSchema: z.object({
        entity_id: z.number().int().positive().describe("Hoomi partner workspace ID."),
        app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
        build_id: z.number().int().positive().describe("Hoomi micro-app build ID."),
        approval_reference: approvalReference.describe("Fresh receipt from the Hoomi write-approval endpoint.")
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ entity_id, app_id, build_id, approval_reference }) => {
      try {
        await requireWriteApproval(approvalStore, principal, "hoomi_delete_micro_app_build", approval_reference, {
          entity_id,
          app_id,
          build_id
        });
        const response = await sdk.builds.delete(entity_id, app_id, build_id);
        return {
          content: [
            {
              type: "text" as const,
              text: serialize(
                { deleted: true, entity_id, app_id, build_id, message: response.message ?? "Micro app build deleted" },
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
    ["hoomi_submit_build_for_review", "Submit a Hoomi micro-app build for review.", "submitForReview"],
    ["hoomi_mark_build_ready_to_release", "Mark a Hoomi micro-app build ready to release.", "markReadyToRelease"]
  ] as const;

  for (const [name, description, operation] of buildActionTools) {
    server.registerTool(
      name,
      {
        title: description,
        description: `${description} This changes the build lifecycle; only call after explicit human confirmation.`,
        inputSchema: z.object({
          entity_id: z.number().int().positive().describe("Hoomi partner workspace ID."),
          app_id: z.number().int().positive().describe("Hoomi micro-app ID."),
          build_id: z.number().int().positive().describe("Hoomi micro-app build ID."),
          approval_reference: approvalReference.describe("Fresh receipt from the Hoomi write-approval endpoint.")
        }),
        annotations: writeAnnotations
      },
      async ({ entity_id, app_id, build_id, approval_reference }) => {
        try {
          await requireWriteApproval(approvalStore, principal, name, approval_reference, {
            entity_id,
            app_id,
            build_id
          });
          const build = requireBuild(await sdk.builds[operation](entity_id, app_id, build_id));
          return { content: [{ type: "text" as const, text: serialize(sanitizeBuild(build), maxToolOutputBytes) }] };
        } catch (error) {
          return toolFailure(error, maxToolOutputBytes);
        }
      }
    );
  }
}
