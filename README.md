# Hoomi MCP

First-party Model Context Protocol server for Hoomi clients and services.

## Current Scope

The foundation exposes:

- `GET /healthz` for liveness
- `GET /readyz` for readiness
- `POST /mcp` using MCP Streamable HTTP in stateless mode

Hoomi API tools are intentionally not exposed yet. They will be added as typed, allowlisted tools with separate read and mutation policies.

## Authentication

Production uses the existing Hoomi session JWT:

```http
Authorization: Bearer <session_token>
```

The server verifies the HMAC signature, exact `HS256` algorithm, `HOOMI-API` issuer, numeric subject, and expiration. `HOOMI_JWT_SECRET` must be supplied through a secret manager or runtime environment and must never be committed.

The current Hoomi JWT predates a dedicated MCP audience/resource claim. This first-party adapter therefore treats the validated Hoomi session as an internal trust boundary. A public remote MCP deployment must add a separate audience-bound OAuth token exchange before it is enabled for external clients.

## Local Development

Requirements: Node.js 22 and npm.

```powershell
Copy-Item .env.example .env
npm install
npm run typecheck
npm test
npm run dev
```

For an unauthenticated local smoke test only, set both values explicitly:

```text
MCP_AUTH_MODE=disabled
ALLOW_INSECURE_LOCAL=true
NODE_ENV=development
```

Never use that mode in Docker production or a shared environment.

## Docker

The service listens on port `8300` and the compose file maps host port `8300` to container port `8300`.

```powershell
Copy-Item .env.example .env
# Fill HOOMI_JWT_SECRET with the runtime secret.
docker compose up --build
```

The container runs as the non-root `node` user, drops Linux capabilities, uses a read-only filesystem, and has a health check on `/healthz`.

## Standards

- Streamable HTTP is the only transport exposed by this service.
- The transport is stateless so instances can scale horizontally without an in-memory session store.
- Host validation is delegated to the official MCP Express helper and configured through `MCP_ALLOWED_HOSTS`.
- Browser origins must be explicitly listed in `MCP_ALLOWED_ORIGINS`; wildcard origins are rejected.
- Authorization values, cookies, request bodies containing secrets, and JWT library details are not logged.
- Tools must not accept model-controlled arbitrary URLs, headers, or credentials.
