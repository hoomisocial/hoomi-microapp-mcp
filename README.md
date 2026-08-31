# Hoomi MCP

First-party Model Context Protocol server for Hoomi clients and services.

## Current Scope

The foundation exposes:

- `GET /healthz` for liveness
- `GET /readyz` for readiness
- `POST /mcp` using MCP Streamable HTTP in stateless mode
- `POST /v1/write-approvals` for short-lived, argument-bound write-approval receipts

The MCP endpoint exposes six read-only `hoomi_sdk_*` documentation tools without a bearer token. A request with a valid Hoomi session also receives the authenticated Hoomi tools for profile/workspaces, micro-app discovery and CRUD, app members, builds, build submissions, and build lifecycle actions. Mutations require a fresh approval receipt issued after a client shows the exact arguments to a human; the boolean `confirm` flag is not trusted. App secrets are delivered only through a one-time authenticated handoff and are never returned as tool output.

SDK tools read only the fixed directory configured by `HOOMI_SDK_SOURCE_DIR`. The directory must be a public-safe, read-only SDK snapshot; it is never fetched, written, installed, or built by this service. Set `HOOMI_SDK_REVISION` to report the immutable snapshot revision in `hoomi_sdk_status` and `HOOMI_SDK_SOURCE_DIGEST` to verify its SHA-256 content digest. Production requires the digest; `/readyz` stays unavailable until the snapshot exists and matches it.

## Authentication

Hoomi tools and the write-approval and secret-handoff endpoints use the existing Hoomi session JWT:

```http
Authorization: Bearer <session_token>
```

The server verifies the HMAC signature, exact `HS256` algorithm, `HOOMI-API` issuer, numeric subject, expiration, and configured audience. Production also requires `HOOMI_JWT_AUDIENCE`; `HOOMI_JWT_SECRET` must be supplied through a secret manager or runtime environment and must never be committed.

The current Hoomi JWT predates a dedicated MCP audience/resource claim. Development and test configurations may omit the audience for internal wiring tests, but production fails closed without one. A public remote MCP deployment must still add a separate audience-bound OAuth token exchange before it is enabled for external clients.

Write clients must first `POST /v1/write-approvals` with the tool name and exact JSON arguments after human approval. The returned receipt is short-lived, scoped to the authenticated user and argument hash, and consumed once when the write tool runs. The endpoint is not an independent proof of human approval and is not a replacement for Hoomi API authorization.

## Local Development

Requirements: Node.js 22 and npm.

```powershell
Copy-Item .env.example .env
npm install
npm run typecheck
npm test
npm run dev
```

For a local unauthenticated SDK-only smoke test, no auth setting is required. The following mode is still available for local Hoomi wiring tests, but it exposes no Hoomi tools because no upstream bearer is available:

```text
MCP_AUTH_MODE=disabled
ALLOW_INSECURE_LOCAL=true
NODE_ENV=development
```

Never use that mode in Docker production or a shared environment.

## How to Use Locally

This is an HTTP MCP server using MCP Streamable HTTP. Configure your MCP client with the server URL; do not configure it as a stdio `command` server.

1. Prepare a local SDK snapshot and point `HOOMI_SDK_SOURCE_DIR` at it. For a local SDK-only run, use these values in `.env`:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=8300
MCP_PATH=/mcp
MCP_AUTH_MODE=disabled
ALLOW_INSECURE_LOCAL=true
SECRET_HANDOFF_STORE=memory
HOOMI_SDK_SOURCE_DIR=C:\path\to\public-sdk-snapshot
```

Comment out `HOOMI_SDK_SOURCE_DIGEST` for local development unless it matches the snapshot. Then start the server with `npm run dev`.

2. Confirm the local server is running:

```powershell
Invoke-RestMethod http://localhost:8300/healthz
Invoke-RestMethod http://localhost:8300/readyz
```

3. Add the server to an MCP client using the Streamable HTTP option and this URL:

```text
http://localhost:8300/mcp
```

The common URL-based configuration shape is:

```json
{
  "mcpServers": {
    "hoomi-local": {
      "url": "http://localhost:8300/mcp"
    }
  }
}
```

Client configuration field names vary, but the important values are `Streamable HTTP` and `http://localhost:8300/mcp`. The server is stateless and does not expose a legacy standalone SSE endpoint or a stdio transport.

4. The SDK-only local mode exposes these read-only tools without authentication: `hoomi_sdk_status`, `hoomi_sdk_search`, `hoomi_sdk_get_source`, `hoomi_sdk_get_api`, `hoomi_sdk_get_guidance`, and `hoomi_sdk_get_example`.

5. To expose authenticated Hoomi tools locally, use `MCP_AUTH_MODE=hoomi-session`, provide `HOOMI_JWT_SECRET`, and configure the MCP client to send the Hoomi session token:

```json
{
  "mcpServers": {
    "hoomi-local": {
      "url": "http://localhost:8300/mcp",
      "headers": {
        "Authorization": "Bearer <hoomi_session_jwt>"
      }
    }
  }
}
```

In local development, remove `HOOMI_JWT_AUDIENCE` unless the session JWT contains the configured audience. Hoomi write tools additionally require a fresh receipt from `POST http://localhost:8300/v1/write-approvals` for the exact arguments.

## Docker

The service listens on port `8300` and the compose file binds it to host loopback only. Put a TLS reverse proxy or edge in front of it before any network exposure. Production requires an explicit `HOOMI_API_BASE_URL` using HTTPS, Redis-backed handoffs/approvals, both encryption/JWT secrets from a secret manager, a production JWT audience, a matching `HOOMI_SDK_SOURCE_DIGEST`, and a public-safe SDK snapshot mounted at `/opt/hoomi-sdk-source` or another `HOOMI_SDK_SOURCE_DIR`.

```powershell
Copy-Item .env.example .env
# Fill HOOMI_JWT_SECRET with the runtime secret.
docker compose up --build
```

The container runs as the non-root `node` user, drops Linux capabilities, uses a read-only filesystem, and has a readiness health check on `/readyz`.

## Standards

- Streamable HTTP is the only transport exposed by this service.
- The transport is stateless so instances can scale horizontally without an in-memory session store.
- Host validation is delegated to the official MCP Express helper and configured through `MCP_ALLOWED_HOSTS`.
- Browser origins must be explicitly listed in `MCP_ALLOWED_ORIGINS`; wildcard origins are rejected.
- SDK documentation tools are read-only and tokenless by design; keep `HOOMI_SDK_SOURCE_DIR` limited to a public-safe source snapshot.
- Authorization values, cookies, request bodies containing secrets, and JWT library details are not logged. Secret and approval references are redacted from request paths in logs.
- Tools must not accept model-controlled arbitrary URLs, headers, or credentials.
- Upstream calls are restricted to `/v2/` Hoomi routes, use a timeout and response-size cap, reject redirects, require an HTTPS production base URL, and forward only the validated session bearer.
- Production readiness includes Redis and the SDK snapshot; the container health check uses `/readyz`, not only process liveness.
