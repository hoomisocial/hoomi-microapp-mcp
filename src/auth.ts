import { jwtVerify } from "jose";

import type { AppConfig } from "./config.js";

export interface AuthenticatedPrincipal {
  userId: number | null;
  issuer: string | null;
  expiresAt: Date | null;
  sessionToken?: string;
  mode: "hoomi-session" | "disabled";
}

export class AuthenticationError extends Error {
  readonly code = "invalid_token";

  constructor() {
    super("invalid or expired authorization token");
    this.name = "AuthenticationError";
  }
}

function extractBearerToken(authorizationHeader: string | undefined): string {
  if (!authorizationHeader) {
    throw new AuthenticationError();
  }

  const match = authorizationHeader.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) {
    throw new AuthenticationError();
  }

  return match[1];
}

export async function authenticateRequest(
  authorizationHeader: string | undefined,
  config: AppConfig
): Promise<AuthenticatedPrincipal> {
  if (config.authMode === "disabled") {
    return {
      userId: null,
      issuer: null,
      expiresAt: null,
      mode: "disabled"
    };
  }

  if (!config.hoomiJwtSecret) {
    throw new Error("Hoomi JWT verification is not configured");
  }

  const token = extractBearerToken(authorizationHeader);

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(config.hoomiJwtSecret), {
      algorithms: ["HS256"],
      issuer: config.hoomiJwtIssuer,
      ...(config.hoomiJwtAudience ? { audience: config.hoomiJwtAudience } : {}),
      clockTolerance: 5
    });

    if (typeof payload.sub !== "string" || !/^\d+$/.test(payload.sub)) {
      throw new AuthenticationError();
    }

    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId <= 0 || typeof payload.exp !== "number") {
      throw new AuthenticationError();
    }

    return {
      userId,
      issuer: config.hoomiJwtIssuer,
      expiresAt: new Date(payload.exp * 1000),
      sessionToken: token,
      mode: "hoomi-session"
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }

    // Keep JWT library details out of the response and logs.
    throw new AuthenticationError();
  }
}
