import { randomUUID } from "node:crypto";

import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";

import { authenticateRequest, AuthenticationError, type AuthenticatedPrincipal } from "./auth.js";
import type { AppConfig } from "./config.js";
import { createMcpServer } from "./mcp.js";
import type { SecretHandoffStore } from "./secrets/handoff.js";

function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const suppliedId = req.get("x-request-id");
  const requestId = suppliedId && /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedId) ? suppliedId : randomUUID();
  const startedAt = performance.now();

  res.locals.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  res.on("finish", () => {
    console.info(
      JSON.stringify({
        event: "http_request",
        request_id: requestId,
        method: req.method,
        path: req.originalUrl.split("?", 1)[0],
        status: res.statusCode,
        duration_ms: Math.round(performance.now() - startedAt)
      })
    );
  });

  next();
}

function originPolicy(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.get("origin");

    if (origin && !config.allowedOrigins.includes(origin)) {
      res.status(403).json({ error: "origin_not_allowed" });
      return;
    }

    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Protocol-Version");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, X-Request-ID");
      res.setHeader("Vary", "Origin");
    }

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}

function authenticationMiddleware(config: AppConfig) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.locals.auth = await authenticateRequest(req.get("authorization"), config);
      next();
    } catch (error) {
      if (error instanceof AuthenticationError) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="hoomi-mcp", error="invalid_token"');
        res.status(401).json({ error: error.code, request_id: res.locals.requestId });
        return;
      }

      next(error);
    }
  };
}

async function handleMcpRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  const principal = res.locals.auth;
  if (!principal) {
    next(new Error("authenticated principal was not attached to the request"));
    return;
  }

  const mcpServer = createMcpServer(principal, req.app.locals.config, req.app.locals.secretHandoffStore);
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }

    next(error);
  } finally {
    await mcpServer.close().catch(() => undefined);
  }
}

async function consumeSecretHandoff(
  req: Request,
  res: Response,
  next: NextFunction,
  store: SecretHandoffStore
): Promise<void> {
  const principal = res.locals.auth as AuthenticatedPrincipal | undefined;
  if (!principal?.userId) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="hoomi-mcp"');
    res.status(401).json({ error: "invalid_token", request_id: res.locals.requestId });
    return;
  }

  try {
    const reference = req.params.reference;
    if (typeof reference !== "string") {
      res.status(404).json({ error: "secret_handoff_not_found", request_id: res.locals.requestId });
      return;
    }

    const payload = await store.consume(principal.userId, reference);
    if (!payload) {
      res.status(404).json({ error: "secret_handoff_not_found", request_id: res.locals.requestId });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.status(200).json({
      app_id: payload.appId,
      app_secret: payload.appSecret,
      expires_at: payload.expiresAt
    });
  } catch (error) {
    next(error);
  }
}

function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  console.error(
    JSON.stringify({
      event: "http_error",
      request_id: res.locals.requestId,
      method: req.method,
      path: req.originalUrl.split("?", 1)[0],
      error: error instanceof Error ? error.name : "UnknownError"
    })
  );

  if (res.headersSent) {
    res.end();
    return;
  }

  res.status(500).json({ error: "internal_server_error", request_id: res.locals.requestId });
}

export function createApp(config: AppConfig, secretHandoffStore: SecretHandoffStore): Express {
  const app = createMcpExpressApp({ host: config.host, allowedHosts: config.allowedHosts });
  app.locals.config = config;
  app.locals.secretHandoffStore = secretHandoffStore;

  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(requestIdMiddleware);

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok", service: "hoomi-mcp" });
  });

  app.get("/readyz", (_req, res) => {
    res.status(200).json({ status: "ready", service: "hoomi-mcp" });
  });

  app.use(config.mcpPath, originPolicy(config));
  app.use(config.mcpPath, authenticationMiddleware(config));
  app.use(express.json({ limit: "8mb", type: ["application/json", "application/*+json"] }));
  app.post(config.mcpPath, (req, res, next) => {
    void handleMcpRequest(req, res, next);
  });
  app.all(config.mcpPath, (_req, res) => {
    res.setHeader("Allow", "POST, OPTIONS");
    res.status(405).json({ error: "method_not_allowed" });
  });

  app.use(config.secretHandoffPath, originPolicy(config));
  app.use(config.secretHandoffPath, authenticationMiddleware(config));
  app.post(`${config.secretHandoffPath}/:reference/consume`, (req, res, next) => {
    void consumeSecretHandoff(req, res, next, secretHandoffStore);
  });

  app.use(errorHandler);
  return app;
}
