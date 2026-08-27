import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8300),
  MCP_PATH: z
    .string()
    .trim()
    .regex(/^\/[A-Za-z0-9/_-]*$/)
    .default("/mcp"),
  MCP_AUTH_MODE: z.enum(["hoomi-session", "disabled"]).default("hoomi-session"),
  HOOMI_JWT_SECRET: z.string().min(32).optional(),
  HOOMI_JWT_ISSUER: z.string().trim().min(1).default("HOOMI-API"),
  HOOMI_API_BASE_URL: z.string().url().default("https://apidev.hoomi.social"),
  HOOMI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
  HOOMI_MAX_RESPONSE_BYTES: z.coerce.number().int().min(1_024).max(10_000_000).default(2_000_000),
  MCP_MAX_TOOL_OUTPUT_BYTES: z.coerce.number().int().min(1_024).max(1_000_000).default(200_000),
  MCP_ALLOWED_HOSTS: z.string().default("localhost,127.0.0.1,[::1]"),
  MCP_ALLOWED_ORIGINS: z.string().default(""),
  ALLOW_INSECURE_LOCAL: z.enum(["true", "false"]).default("false")
});

export type AuthMode = "hoomi-session" | "disabled";

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  mcpPath: string;
  authMode: AuthMode;
  hoomiJwtSecret?: string;
  hoomiJwtIssuer: string;
  hoomiApiBaseUrl: string;
  hoomiRequestTimeoutMs: number;
  hoomiMaxResponseBytes: number;
  maxToolOutputBytes: number;
  allowedHosts: string[];
  allowedOrigins: string[];
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOrigins(value: string): string[] {
  return splitCsv(value).map((origin) => {
    if (origin === "*") {
      throw new Error("MCP_ALLOWED_ORIGINS must not contain a wildcard");
    }

    const parsed = new URL(origin);
    if (parsed.origin !== origin || !["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`MCP_ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }

    return parsed.origin;
  });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const allowedHosts = splitCsv(parsed.MCP_ALLOWED_HOSTS);

  if (allowedHosts.length === 0) {
    throw new Error("MCP_ALLOWED_HOSTS must contain at least one hostname");
  }

  if (parsed.MCP_PATH === "/") {
    throw new Error("MCP_PATH must not be the root path");
  }

  if (parsed.MCP_AUTH_MODE === "hoomi-session" && !parsed.HOOMI_JWT_SECRET) {
    throw new Error("HOOMI_JWT_SECRET is required when MCP_AUTH_MODE=hoomi-session");
  }

  if (
    parsed.MCP_AUTH_MODE === "disabled" &&
    (parsed.NODE_ENV === "production" || parsed.ALLOW_INSECURE_LOCAL !== "true")
  ) {
    throw new Error(
      "MCP_AUTH_MODE=disabled requires ALLOW_INSECURE_LOCAL=true and a non-production NODE_ENV"
    );
  }

  const upstreamUrl = new URL(parsed.HOOMI_API_BASE_URL);
  if (upstreamUrl.username || upstreamUrl.password || !["http:", "https:"].includes(upstreamUrl.protocol)) {
    throw new Error("HOOMI_API_BASE_URL must be an HTTP(S) URL without embedded credentials");
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    mcpPath: parsed.MCP_PATH,
    authMode: parsed.MCP_AUTH_MODE,
    hoomiJwtSecret: parsed.HOOMI_JWT_SECRET,
    hoomiJwtIssuer: parsed.HOOMI_JWT_ISSUER,
    hoomiApiBaseUrl: upstreamUrl.origin + upstreamUrl.pathname.replace(/\/$/, ""),
    hoomiRequestTimeoutMs: parsed.HOOMI_REQUEST_TIMEOUT_MS,
    hoomiMaxResponseBytes: parsed.HOOMI_MAX_RESPONSE_BYTES,
    maxToolOutputBytes: parsed.MCP_MAX_TOOL_OUTPUT_BYTES,
    allowedHosts,
    allowedOrigins: parseOrigins(parsed.MCP_ALLOWED_ORIGINS)
  };
}
