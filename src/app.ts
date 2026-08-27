import { randomUUID } from "node:crypto";

import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";

import { authenticateRequest, AuthenticationError } from "./auth.js";
import type { AppConfig } from "./config.js";
import { createMcpServer } from "./mcp.js";

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

  const mcpServer = createMcpServer(principal, req.app.locals.config);
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

export function createApp(config: AppConfig): Express {
  const app = createMcpExpressApp({ host: config.host, allowedHosts: config.allowedHosts });
  app.locals.config = config;

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
  app.use(express.json({ limit: "1mb", type: ["application/json", "application/*+json"] }));
  app.post(config.mcpPath, (req, res, next) => {
    void handleMcpRequest(req, res, next);
  });
  app.all(config.mcpPath, (_req, res) => {
    res.setHeader("Allow", "POST, OPTIONS");
    res.status(405).json({ error: "method_not_allowed" });
  });

  app.use(errorHandler);
  return app;
}
