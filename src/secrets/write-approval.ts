import { createHash, randomBytes } from "node:crypto";

import { createClient, type RedisClientType } from "redis";

import type { AppConfig } from "../config.js";

export interface WriteApproval {
  reference: string;
  expiresAt: string;
}

export interface WriteApprovalStore {
  create(userId: number, toolName: string, argumentsHash: string, ttlSeconds: number): Promise<WriteApproval>;
  consume(userId: number, toolName: string, argumentsHash: string, reference: string): Promise<boolean>;
  isReady(): Promise<boolean>;
  close(): Promise<void>;
}

const keyPrefix = "hoomi-mcp:write-approval";
export const writeApprovalReferencePattern = /^[a-f0-9]{64}$/;
const argumentsHashPattern = /^[a-f0-9]{64}$/;
const writeToolArgumentKeys: Record<string, readonly string[]> = {
  hoomi_create_micro_app: [
    "entity_id",
    "app_type",
    "app_name",
    "app_bundle",
    "app_default_language",
    "app_category_id",
    "app_age_ratings_id",
    "app_description",
    "app_tagline",
    "app_privacy_url",
    "app_tnc_url",
    "marketing_url",
    "app_allowed_countries",
    "cs_phone",
    "cs_email",
    "app_logo"
  ],
  hoomi_update_micro_app: [
    "entity_id",
    "app_id",
    "app_type",
    "app_bundle",
    "app_default_language",
    "app_category_id",
    "app_age_ratings_id",
    "app_privacy_url",
    "app_tnc_url",
    "marketing_url",
    "app_allowed_countries",
    "cs_phone",
    "cs_email",
    "status",
    "app_lang",
    "app_name",
    "app_description",
    "app_tagline",
    "localized_logos"
  ],
  hoomi_delete_micro_app: ["entity_id", "app_id"],
  hoomi_refresh_app_secret: ["entity_id", "app_id"],
  hoomi_add_app_member: ["entity_id", "app_id", "email", "role_id"],
  hoomi_remove_app_member: ["entity_id", "app_id", "member_id"],
  hoomi_update_app_member_role: ["entity_id", "app_id", "member_id", "role_id"],
  hoomi_create_micro_app_build: [
    "entity_id",
    "app_id",
    "app_lang",
    "app_version",
    "app_url",
    "app_callback_url",
    "app_permissions",
    "app_domains",
    "app_ip_whitelist",
    "app_demo_email",
    "app_previews"
  ],
  hoomi_update_micro_app_build: [
    "entity_id",
    "app_id",
    "build_id",
    "app_lang",
    "app_version",
    "app_url",
    "app_callback_url",
    "app_permissions",
    "app_domains",
    "app_ip_whitelist",
    "app_demo_email"
  ],
  hoomi_delete_micro_app_build: ["entity_id", "app_id", "build_id"],
  hoomi_create_build_submission: ["entity_id", "app_id", "build_id", "app_review", "review_files"],
  hoomi_submit_build_for_review: ["entity_id", "app_id", "build_id"],
  hoomi_mark_build_ready_to_release: ["entity_id", "app_id", "build_id"]
};
const writeToolNames = new Set(Object.keys(writeToolArgumentKeys));
const writeToolDefaults: Record<string, Readonly<Record<string, unknown>>> = {
  hoomi_create_micro_app: { app_allowed_countries: [] },
  hoomi_update_micro_app: { app_allowed_countries: [], localized_logos: [] },
  hoomi_create_micro_app_build: {
    app_permissions: [],
    app_domains: [],
    app_ip_whitelist: [],
    app_previews: []
  },
  hoomi_update_micro_app_build: { app_permissions: [], app_domains: [], app_ip_whitelist: [] },
  hoomi_create_build_submission: { review_files: [] }
};

function storageKey(userId: number, reference: string): string {
  return `${keyPrefix}:${userId}:${reference}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])])
    );
  }

  return value;
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalizeValue(nested)]));
  }

  return value;
}

function normalizeUpload(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return normalizeValue(value);
  }

  const upload = value as Record<string, unknown>;
  return {
    filename: normalizeValue(upload.filename),
    content_type: normalizeValue(upload.content_type),
    data_base64: normalizeValue(upload.data_base64)
  };
}

function normalizeArgument(key: string, value: unknown): unknown {
  if (key === "app_logo") {
    return normalizeUpload(value);
  }

  if (key === "app_previews" || key === "review_files") {
    return Array.isArray(value) ? value.map(normalizeUpload) : normalizeValue(value);
  }

  if (key === "localized_logos") {
    return Array.isArray(value)
      ? value.map((item) => {
          if (typeof item !== "object" || item === null || Array.isArray(item)) {
            return normalizeValue(item);
          }

          const logo = item as Record<string, unknown>;
          return {
            language: normalizeValue(logo.language),
            file: normalizeUpload(logo.file)
          };
        })
      : normalizeValue(value);
  }

  return normalizeValue(value);
}

export function hasOnlyWriteToolArguments(toolName: string, value: Record<string, unknown>): boolean {
  const keys = writeToolArgumentKeys[toolName];
  return Boolean(keys) && Object.keys(value).every((key) => keys.includes(key));
}

export function normalizeWriteApprovalArguments(
  toolName: string,
  value: Record<string, unknown>
): Record<string, unknown> {
  const keys = writeToolArgumentKeys[toolName];
  if (!keys) {
    throw new Error("unknown write tool");
  }

  const defaults = writeToolDefaults[toolName] ?? {};
  const normalized: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.hasOwn(value, key)) {
      normalized[key] = normalizeArgument(key, value[key]);
    } else if (Object.hasOwn(defaults, key)) {
      normalized[key] = normalizeArgument(key, defaults[key]);
    }
  }

  return normalized;
}

export function hashWriteApprovalArguments(value: unknown): string {
  const canonical = JSON.stringify(canonicalize(value));
  if (canonical === undefined) {
    throw new Error("write approval arguments must be JSON serializable");
  }

  return createHash("sha256").update(canonical).digest("hex");
}

export function isWriteToolName(value: string): boolean {
  return writeToolNames.has(value);
}

function isValidHash(value: string): boolean {
  return argumentsHashPattern.test(value);
}

function isExpired(expiresAt: string): boolean {
  const timestamp = Date.parse(expiresAt);
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

export class MemoryWriteApprovalStore implements WriteApprovalStore {
  private readonly entries = new Map<
    string,
    { toolName: string; argumentsHash: string; expiresAt: string; timer: NodeJS.Timeout }
  >();

  async create(userId: number, toolName: string, argumentsHash: string, ttlSeconds: number): Promise<WriteApproval> {
    const reference = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const key = storageKey(userId, reference);
    const timer = setTimeout(() => this.entries.delete(key), ttlSeconds * 1000);
    timer.unref();
    this.entries.set(key, { toolName, argumentsHash, expiresAt, timer });
    return { reference, expiresAt };
  }

  async consume(userId: number, toolName: string, argumentsHash: string, reference: string): Promise<boolean> {
    if (!writeApprovalReferencePattern.test(reference) || !isValidHash(argumentsHash)) {
      return false;
    }

    const key = storageKey(userId, reference);
    const entry = this.entries.get(key);
    if (!entry) {
      return false;
    }

    this.entries.delete(key);
    clearTimeout(entry.timer);
    return entry.toolName === toolName && entry.argumentsHash === argumentsHash && !isExpired(entry.expiresAt);
  }

  async isReady(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer);
    }
    this.entries.clear();
  }
}

class RedisWriteApprovalStore implements WriteApprovalStore {
  constructor(private readonly client: RedisClientType) {}

  async create(userId: number, toolName: string, argumentsHash: string, ttlSeconds: number): Promise<WriteApproval> {
    const reference = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const value = JSON.stringify({ toolName, argumentsHash, expiresAt });
    const result = await this.client.set(storageKey(userId, reference), value, { EX: ttlSeconds, NX: true });
    if (result !== "OK") {
      throw new Error("write approval reference collision");
    }

    return { reference, expiresAt };
  }

  async consume(userId: number, toolName: string, argumentsHash: string, reference: string): Promise<boolean> {
    if (!writeApprovalReferencePattern.test(reference) || !isValidHash(argumentsHash)) {
      return false;
    }

    const value = await this.client.getDel(storageKey(userId, reference));
    if (!value) {
      return false;
    }

    try {
      const parsed = JSON.parse(value) as Partial<WriteApproval> & { toolName?: string; argumentsHash?: string };
      return (
        parsed.toolName === toolName &&
        parsed.argumentsHash === argumentsHash &&
        typeof parsed.expiresAt === "string" &&
        !isExpired(parsed.expiresAt)
      );
    } catch {
      return false;
    }
  }

  async isReady(): Promise<boolean> {
    if (!this.client.isReady) {
      return false;
    }

    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.close();
    }
  }
}

export async function openWriteApprovalStore(config: AppConfig): Promise<WriteApprovalStore> {
  if (config.secretHandoffStore === "memory") {
    return new MemoryWriteApprovalStore();
  }

  if (!config.redisUrl) {
    throw new Error("REDIS_URL is required for the Redis write approval store");
  }

  const client = createClient({ url: config.redisUrl, disableOfflineQueue: true }).on("error", (error: unknown) => {
    console.error(
      JSON.stringify({
        event: "write_approval_store_error",
        error: error instanceof Error ? error.name : "UnknownError"
      })
    );
  });
  await client.connect();
  return new RedisWriteApprovalStore(client);
}
