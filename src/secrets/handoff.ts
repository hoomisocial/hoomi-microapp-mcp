import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { createClient, type RedisClientType } from "redis";

import type { AppConfig } from "../config.js";

export interface SecretHandoffPayload {
  appId: number;
  appSecret: string;
  expiresAt: string;
}

export interface SecretHandoffStore {
  create(userId: number, appId: number, appSecret: string, ttlSeconds: number): Promise<{
    reference: string;
    expiresAt: string;
  }>;
  consume(userId: number, reference: string): Promise<SecretHandoffPayload | null>;
  close(): Promise<void>;
}

const keyPrefix = "hoomi-mcp:secret-handoff";
const referencePattern = /^[a-f0-9]{64}$/;

function storageKey(userId: number, reference: string): string {
  return `${keyPrefix}:${userId}:${reference}`;
}

function deriveEncryptionKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function encodePayload(payload: SecretHandoffPayload, encryptionKey?: Buffer): string {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  if (!encryptionKey) {
    return `plain.${plaintext.toString("base64url")}`;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decodePayload(encoded: string, encryptionKey?: Buffer): SecretHandoffPayload | null {
  try {
    const parts = encoded.split(".");
    let plaintext: Buffer;

    if (parts[0] === "plain" && parts.length === 2 && !encryptionKey) {
      plaintext = Buffer.from(parts[1], "base64url");
    } else if (parts[0] === "v1" && parts.length === 4 && encryptionKey) {
      const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(parts[1], "base64url"));
      decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(parts[3], "base64url")),
        decipher.final()
      ]);
    } else {
      return null;
    }

    const parsed = JSON.parse(plaintext.toString("utf8")) as Partial<SecretHandoffPayload>;
    const appId = parsed.appId;
    const appSecret = parsed.appSecret;
    const expiresAt = parsed.expiresAt;
    if (
      typeof appId !== "number" ||
      !Number.isSafeInteger(appId) ||
      appId <= 0 ||
      typeof appSecret !== "string" ||
      appSecret.length === 0 ||
      typeof expiresAt !== "string"
    ) {
      return null;
    }

    return {
      appId,
      appSecret,
      expiresAt
    };
  } catch {
    return null;
  }
}

export class MemorySecretHandoffStore implements SecretHandoffStore {
  private readonly entries = new Map<string, { payload: SecretHandoffPayload; timer: NodeJS.Timeout }>();

  async create(userId: number, appId: number, appSecret: string, ttlSeconds: number) {
    const reference = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const key = storageKey(userId, reference);
    const timer = setTimeout(() => this.entries.delete(key), ttlSeconds * 1000);
    timer.unref();
    this.entries.set(key, { payload: { appId, appSecret, expiresAt }, timer });
    return { reference, expiresAt };
  }

  async consume(userId: number, reference: string): Promise<SecretHandoffPayload | null> {
    if (!referencePattern.test(reference)) {
      return null;
    }

    const key = storageKey(userId, reference);
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }

    this.entries.delete(key);
    clearTimeout(entry.timer);
    return entry.payload;
  }

  async close(): Promise<void> {
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer);
    }
    this.entries.clear();
  }
}

class RedisSecretHandoffStore implements SecretHandoffStore {
  constructor(
    private readonly client: RedisClientType,
    private readonly encryptionKey?: Buffer
  ) {}

  async create(userId: number, appId: number, appSecret: string, ttlSeconds: number) {
    const reference = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const payload = encodePayload({ appId, appSecret, expiresAt }, this.encryptionKey);
    const result = await this.client.set(storageKey(userId, reference), payload, { EX: ttlSeconds, NX: true });
    if (result !== "OK") {
      throw new Error("secret handoff reference collision");
    }

    return { reference, expiresAt };
  }

  async consume(userId: number, reference: string): Promise<SecretHandoffPayload | null> {
    if (!referencePattern.test(reference)) {
      return null;
    }

    const encoded = await this.client.getDel(storageKey(userId, reference));
    return encoded ? decodePayload(encoded, this.encryptionKey) : null;
  }

  async close(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.close();
    }
  }
}

export async function openSecretHandoffStore(config: AppConfig): Promise<SecretHandoffStore> {
  if (config.secretHandoffStore === "memory") {
    return new MemorySecretHandoffStore();
  }

  if (!config.redisUrl) {
    throw new Error("REDIS_URL is required for the Redis secret handoff store");
  }

  const client = createClient({ url: config.redisUrl, disableOfflineQueue: true }).on("error", (error: unknown) => {
    console.error(
      JSON.stringify({
        event: "secret_handoff_store_error",
        error: error instanceof Error ? error.name : "UnknownError"
      })
    );
  });
  await client.connect();
  return new RedisSecretHandoffStore(
    client,
    config.secretHandoffEncryptionKey ? deriveEncryptionKey(config.secretHandoffEncryptionKey) : undefined
  );
}
