import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8300),
  MCP_PATH: z
    .string()
    .trim()
    .regex(/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/)
    .default("/mcp"),
  MCP_AUTH_MODE: z.enum(["hoomi-session", "disabled"]).default("hoomi-session"),
  HOOMI_JWT_SECRET: z.string().min(32).optional(),
  HOOMI_JWT_ISSUER: z.string().trim().min(1).default("HOOMI-API"),
  HOOMI_JWT_AUDIENCE: z.string().trim().min(1).optional(),
  HOOMI_API_BASE_URL: z.string().url().optional(),
  HOOMI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
  HOOMI_MAX_RESPONSE_BYTES: z.coerce.number().int().min(1_024).max(10_000_000).default(2_000_000),
  MCP_MAX_TOOL_OUTPUT_BYTES: z.coerce.number().int().min(1_024).max(1_000_000).default(200_000),
  SECRET_HANDOFF_STORE: z.enum(["redis", "memory"]).default("redis"),
  REDIS_URL: z.string().url().optional(),
  SECRET_HANDOFF_TTL_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
  WRITE_APPROVAL_TTL_SECONDS: z.coerce.number().int().min(30).max(900).default(120),
  SECRET_HANDOFF_ENCRYPTION_KEY: z.string().min(32).optional(),
  SECRET_HANDOFF_PATH: z
    .string()
    .trim()
    .regex(/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/)
    .default("/v1/secret-handoffs"),
  WRITE_APPROVAL_PATH: z
    .string()
    .trim()
    .regex(/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/)
    .default("/v1/write-approvals"),
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
  hoomiJwtAudience?: string;
  hoomiApiBaseUrl: string;
  hoomiRequestTimeoutMs: number;
  hoomiMaxResponseBytes: number;
  maxToolOutputBytes: number;
  secretHandoffStore: "redis" | "memory";
  redisUrl?: string;
  secretHandoffTtlSeconds: number;
  writeApprovalTtlSeconds: number;
  secretHandoffEncryptionKey?: string;
  secretHandoffPath: string;
  writeApprovalPath: string;
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

function pathsOverlap(first: string, second: string): boolean {
  const normalizedFirst = first.toLowerCase();
  const normalizedSecond = second.toLowerCase();
  return (
    normalizedFirst === normalizedSecond ||
    normalizedFirst.startsWith(`${normalizedSecond}/`) ||
    normalizedSecond.startsWith(`${normalizedFirst}/`)
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const allowedHosts = splitCsv(parsed.MCP_ALLOWED_HOSTS);

  if (allowedHosts.length === 0) {
    throw new Error("MCP_ALLOWED_HOSTS must contain at least one hostname");
  }

  if (parsed.MCP_AUTH_MODE === "hoomi-session" && !parsed.HOOMI_JWT_SECRET) {
    throw new Error("HOOMI_JWT_SECRET is required when MCP_AUTH_MODE=hoomi-session");
  }

  if (parsed.SECRET_HANDOFF_STORE === "redis" && !parsed.REDIS_URL) {
    throw new Error("REDIS_URL is required when SECRET_HANDOFF_STORE=redis");
  }

  const configuredPaths = [parsed.MCP_PATH, parsed.SECRET_HANDOFF_PATH, parsed.WRITE_APPROVAL_PATH];
  if (
    configuredPaths.some((path, index) =>
      configuredPaths.some((other, otherIndex) => index !== otherIndex && pathsOverlap(path, other))
    )
  ) {
    throw new Error("MCP, secret handoff, and write approval paths must not overlap");
  }

  if (parsed.NODE_ENV === "production" && parsed.SECRET_HANDOFF_STORE !== "redis") {
    throw new Error("SECRET_HANDOFF_STORE=memory is not allowed in production");
  }

  if (parsed.NODE_ENV === "production" && !parsed.SECRET_HANDOFF_ENCRYPTION_KEY) {
    throw new Error("SECRET_HANDOFF_ENCRYPTION_KEY is required in production");
  }

  if (
    parsed.MCP_AUTH_MODE === "disabled" &&
    (parsed.NODE_ENV === "production" || parsed.ALLOW_INSECURE_LOCAL !== "true")
  ) {
    throw new Error(
      "MCP_AUTH_MODE=disabled requires ALLOW_INSECURE_LOCAL=true and a non-production NODE_ENV"
    );
  }

  const configuredApiBaseUrl =
    parsed.HOOMI_API_BASE_URL ?? (parsed.NODE_ENV === "production" ? undefined : "https://apidev.hoomi.social");
  if (!configuredApiBaseUrl) {
    throw new Error("HOOMI_API_BASE_URL is required in production");
  }

  const upstreamUrl = new URL(configuredApiBaseUrl);
  if (upstreamUrl.username || upstreamUrl.password || !["http:", "https:"].includes(upstreamUrl.protocol)) {
    throw new Error("HOOMI_API_BASE_URL must be an HTTP(S) URL without embedded credentials");
  }

  if (parsed.NODE_ENV === "production" && upstreamUrl.protocol !== "https:") {
    throw new Error("HOOMI_API_BASE_URL must use HTTPS in production");
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    mcpPath: parsed.MCP_PATH,
    authMode: parsed.MCP_AUTH_MODE,
    hoomiJwtSecret: parsed.HOOMI_JWT_SECRET,
    hoomiJwtIssuer: parsed.HOOMI_JWT_ISSUER,
    hoomiJwtAudience: parsed.HOOMI_JWT_AUDIENCE,
    hoomiApiBaseUrl: upstreamUrl.origin + upstreamUrl.pathname.replace(/\/$/, ""),
    hoomiRequestTimeoutMs: parsed.HOOMI_REQUEST_TIMEOUT_MS,
    hoomiMaxResponseBytes: parsed.HOOMI_MAX_RESPONSE_BYTES,
    maxToolOutputBytes: parsed.MCP_MAX_TOOL_OUTPUT_BYTES,
    secretHandoffStore: parsed.SECRET_HANDOFF_STORE,
    redisUrl: parsed.REDIS_URL,
    secretHandoffTtlSeconds: parsed.SECRET_HANDOFF_TTL_SECONDS,
    writeApprovalTtlSeconds: parsed.WRITE_APPROVAL_TTL_SECONDS,
    secretHandoffEncryptionKey: parsed.SECRET_HANDOFF_ENCRYPTION_KEY,
    secretHandoffPath: parsed.SECRET_HANDOFF_PATH,
    writeApprovalPath: parsed.WRITE_APPROVAL_PATH,
    allowedHosts,
    allowedOrigins: parseOrigins(parsed.MCP_ALLOWED_ORIGINS)
  };
}
