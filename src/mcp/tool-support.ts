import { HoomiApiError } from "../sdk/hoomi/client.js";
import type { AuthenticatedPrincipal } from "../auth.js";
import {
  hashWriteApprovalArguments,
  normalizeWriteApprovalArguments,
  type WriteApprovalStore
} from "../secrets/write-approval.js";
import { redactSensitiveText } from "../security/redaction.js";

export function serialize(value: unknown, maxBytes: number): string {
  const text = JSON.stringify(value, null, 2) ?? "null";
  return Buffer.byteLength(text, "utf8") <= maxBytes
    ? text
    : JSON.stringify({
        error: "output_too_large",
        message: "Tool output exceeded the configured size limit",
        max_bytes: maxBytes
      });
}

export async function requireWriteApproval(
  store: WriteApprovalStore,
  principal: AuthenticatedPrincipal,
  toolName: string,
  approvalReference: string | undefined,
  argumentsValue: Record<string, unknown>
): Promise<void> {
  if (!principal.userId) {
    throw new HoomiApiError("session_required", "A validated Hoomi session is required for write operations");
  }

  if (
    !approvalReference ||
    !(await store.consume(
      principal.userId,
      toolName,
      hashWriteApprovalArguments(normalizeWriteApprovalArguments(toolName, argumentsValue)),
      approvalReference
    ))
  ) {
    throw new HoomiApiError(
      "write_approval_required",
      "A fresh write-approval receipt for these exact arguments is required"
    );
  }
}

export function toolFailure(error: unknown, maxBytes: number) {
  if (error instanceof HoomiApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: serialize(
            { error: error.code, message: redactSensitiveText(error.message), status: error.status },
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

export const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const;
