import type { AppConfig } from "./config.js";
import { AccountSdk } from "./sdk/hoomi/account.js";
import { HoomiApiClient, HoomiApiError } from "./sdk/hoomi/client.js";

export interface AuthenticatedPrincipal {
  userId: number | null;
  issuer: string | null;
  expiresAt: Date | null;
  sessionToken?: string;
  mode: "hoomi-session" | "disabled" | "anonymous";
}

export class AuthenticationError extends Error {
  readonly code = "invalid_token";

  constructor() {
    super("invalid or expired authorization token");
    this.name = "AuthenticationError";
  }
}

export class AuthenticationUnavailableError extends Error {
  readonly code = "auth_service_unavailable";

  constructor() {
    super("Hoomi could not verify the current session");
    this.name = "AuthenticationUnavailableError";
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

export function anonymousPrincipal(): AuthenticatedPrincipal {
  return {
    userId: null,
    issuer: null,
    expiresAt: null,
    mode: "anonymous"
  };
}

export async function authenticateOptionalRequest(
  authorizationHeader: string | undefined,
  config: AppConfig,
  fetchImpl: typeof fetch = fetch
): Promise<AuthenticatedPrincipal> {
  if (!authorizationHeader) {
    return anonymousPrincipal();
  }

  return authenticateRequest(authorizationHeader, config, fetchImpl);
}

export async function authenticateRequest(
  authorizationHeader: string | undefined,
  config: AppConfig,
  fetchImpl: typeof fetch = fetch
): Promise<AuthenticatedPrincipal> {
  if (config.authMode === "disabled") {
    return {
      userId: null,
      issuer: null,
      expiresAt: null,
      mode: "disabled"
    };
  }

  const token = extractBearerToken(authorizationHeader);
  const client = new HoomiApiClient({
    baseUrl: config.hoomiApiBaseUrl,
    sessionToken: token,
    timeoutMs: config.hoomiRequestTimeoutMs,
    maxResponseBytes: config.hoomiMaxResponseBytes,
    fetchImpl
  });

  try {
    // Let the API that issued the session validate its signature and expiry.
    // MCP receives only the user's bearer token, never the API signing key.
    // The profile ID returned by the authenticated API scopes approvals and
    // one-time secret handoffs to the verified user.
    const profile = await new AccountSdk(client).getProfile();
    if (!Number.isSafeInteger(profile.id) || (profile.id ?? 0) <= 0) {
      throw new AuthenticationError();
    }

    return {
      userId: profile.id ?? null,
      issuer: null,
      expiresAt: null,
      sessionToken: token,
      mode: "hoomi-session"
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }

    if (error instanceof HoomiApiError) {
      if (error.status === 401 || error.status === 403 || error.status === 404) {
        throw new AuthenticationError();
      }
    }

    // Keep upstream details and bearer tokens out of the response and logs.
    throw new AuthenticationUnavailableError();
  }
}
