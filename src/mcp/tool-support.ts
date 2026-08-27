import { HoomiApiError } from "../sdk/hoomi/client.js";

export function serialize(value: unknown, maxBytes: number): string {
  const text = JSON.stringify(value, null, 2);
  return text.length <= maxBytes ? text : `${text.slice(0, maxBytes)}\n[output truncated by hoomi-mcp]`;
}

export function toolFailure(error: unknown, maxBytes: number) {
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

export const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const;
