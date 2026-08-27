import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { HoomiSdk } from "../../sdk/hoomi/index.js";
import type { Build } from "../../sdk/hoomi/index.js";
import { serialize, toolFailure, writeAnnotations } from "../../mcp/tool-support.js";

function sanitizeBuild(value: Build | undefined): unknown {
  if (!value) {
    return null;
  }

  return {
    id: value.id ?? null,
    app_lang: value.app_lang ?? null,
    app_version: value.app_version ?? null,
    app_url: value.app_url ?? null,
    app_previews: value.app_previews ?? [],
    app_callback_url: value.app_callback_url ?? null,
    app_permissions: value.app_permissions ?? [],
    app_domains: value.app_domains ?? [],
    app_ip_whitelist: value.app_ip_whitelist ?? [],
    app_status: value.app_status ?? null,
    submitted_date: value.submitted_date ?? null,
    canceled_date: value.canceled_date ?? null,
    distributed_date: value.distributed_date ?? null,
    created_at: value.created_at ?? null
  };
}

export function registerBuildTools(server: McpServer, sdk: HoomiSdk, maxToolOutputBytes: number): void {
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
          confirm: z.literal(true).describe("Must be true only after explicit human confirmation of this action.")
        }),
        annotations: writeAnnotations
      },
      async ({ entity_id, app_id, build_id }) => {
        try {
          const build = await sdk.builds[operation](entity_id, app_id, build_id);
          return { content: [{ type: "text" as const, text: serialize(sanitizeBuild(build), maxToolOutputBytes) }] };
        } catch (error) {
          return toolFailure(error, maxToolOutputBytes);
        }
      }
    );
  }
}
