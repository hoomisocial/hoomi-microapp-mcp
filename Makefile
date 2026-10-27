# Hoomi MCP: the server deployment, workspace development service, and checks.
#
#   make sdk-pin   pin the Hoomi SDK snapshot the image is built from: writes
#                  HOOMI_SDK_REVISION and its HOOMI_SDK_SOURCE_DIGEST into .env
#   make prod-up   a server: this repository's compose file only, production
#                  mode, on the shared `hoomi` network the builder reaches it on
#   make up        development inside the workspace (root compose.yaml)
#
# Server order: hoomi-infra, hoomi-static-gateway, then here, then microapp-builder.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
WORKSPACE ?= $(abspath $(ROOT)/..)
export DOCKER_CONTEXT ?= default
export MCP_NODE_ENV ?= development
COMPOSE := docker compose --project-directory "$(WORKSPACE)" -f "$(WORKSPACE)/compose.yaml"
COMPOSE_PROD := docker compose --project-directory "$(ROOT)" -p hoomi-mcp -f "$(ROOT)/docker-compose.yml"
export MCP_IMAGE ?= hoomi-microapp-mcp:local
env_var = $(shell grep -m1 '^$(1)=' "$(ROOT)/.env" 2>/dev/null | cut -d= -f2- | tr -d '\r"')
# The SDK commit the image is built from (HOOMI_SDK_REF build arg).
export HOOMI_SDK_REF ?= $(or $(call env_var,HOOMI_SDK_REVISION),master)
SDK_REPOSITORY ?= https://github.com/hoomisocial/hoomi-microapps-sdk-js.git

.PHONY: help prod-up prod-down prod-restart prod-logs prod-ps prod-build sdk-pin sdk-digest check-prod install test typecheck build up down restart logs ps check-docker check-env check-workspace

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  make %-13s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

prod-up: check-docker check-env check-prod ## Server: build and start MCP and Redis in production mode
	@MCP_NODE_ENV=production $(COMPOSE_PROD) up -d --build --wait hoomi-mcp
	@echo "Hoomi MCP: http://127.0.0.1:8300 and hoomi-mcp:8300 on the hoomi network (production, SDK $(HOOMI_SDK_REF))"

prod-down: check-docker ## Server: stop MCP and Redis (Redis data stays)
	@$(COMPOSE_PROD) down

prod-restart: check-docker check-env check-prod ## Server: recreate MCP without rebuilding (re-reads .env)
	@MCP_NODE_ENV=production $(COMPOSE_PROD) up -d --force-recreate --no-build --wait hoomi-mcp

prod-logs: check-docker ## Server: follow MCP logs
	@$(COMPOSE_PROD) logs -f --tail=100 hoomi-mcp

prod-ps: check-docker ## Server: show MCP and Redis status
	@$(COMPOSE_PROD) ps

prod-build: check-docker check-env ## Build the image for HOOMI_SDK_REVISION in .env
	@MCP_NODE_ENV=production $(COMPOSE_PROD) build hoomi-mcp

# Pins REV (default: the SDK's current master), builds that image, and writes
# the revision and the digest of its snapshot into .env.
sdk-pin: check-docker check-env ## Pin the SDK (REV=<commit>, default current master): build, then write revision + digest to .env
	@rev="$${REV:-$$(git ls-remote "$(SDK_REPOSITORY)" refs/heads/master | cut -f1)}"; \
	[[ "$$rev" =~ ^[0-9a-f]{40}$$ ]] || { echo "REV must be a full 40-character commit, got '$$rev'"; exit 1; }; \
	HOOMI_SDK_REF="$$rev" MCP_NODE_ENV=production $(COMPOSE_PROD) build hoomi-mcp; \
	digest="$$($(MAKE) -s --no-print-directory sdk-digest | sed -n 's/^HOOMI_SDK_SOURCE_DIGEST=//p')"; \
	[ -n "$$digest" ] || { echo "could not compute the SDK digest"; exit 1; }; \
	for kv in "HOOMI_SDK_REVISION=$$rev" "HOOMI_SDK_SOURCE_DIGEST=$$digest"; do \
	  key="$${kv%%=*}"; \
	  if grep -qE "^#? ?$$key=" "$(ROOT)/.env"; then sed -i -E "s|^#? ?$$key=.*|$$kv|" "$(ROOT)/.env"; else echo "$$kv" >> "$(ROOT)/.env"; fi; \
	done; \
	echo "pinned the SDK at $$rev (digest $$digest) in .env; now: make prod-up"

define SDK_DIGEST_JS
import { SdkSource } from "/app/dist/features/sdk/source.js";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
const root = "/opt/hoomi-sdk-source";
const source = new SdkSource({ rootDirectory: root });
const manifest = await source["buildManifest"](await source["ensureRoot"]());
const hash = createHash("sha256");
for (const entry of manifest) {
  hash.update(entry.path, "utf8"); hash.update("\0", "utf8");
  hash.update(await fs.readFile(await source["resolveManifestTarget"](entry))); hash.update("\0", "utf8");
}
const digest = hash.digest("hex");
if (!(await new SdkSource({ rootDirectory: root, digest }).isReady())) {
  console.error("computed digest does not verify"); process.exit(1);
}
console.log("HOOMI_SDK_SOURCE_DIGEST=" + digest);
endef
export SDK_DIGEST_JS

sdk-digest: check-docker ## Print HOOMI_SDK_SOURCE_DIGEST of the built image's SDK snapshot
	@docker run --rm -e SDK_DIGEST_JS --entrypoint sh -w /app "$(MCP_IMAGE)" -c 'node --input-type=module -e "$$SDK_DIGEST_JS"'

# Production mode refuses to start without these; say which is missing first.
check-prod:
	@env="$(ROOT)/.env"; missing=""; \
	for v in HOOMI_SDK_REVISION HOOMI_SDK_SOURCE_DIGEST SECRET_HANDOFF_ENCRYPTION_KEY REDIS_PASSWORD HOOMI_API_BASE_URL; do \
	  grep -q "^$$v=." "$$env" || missing="$$missing $$v"; done; \
	grep -q '^SECRET_HANDOFF_STORE=redis' "$$env" || missing="$$missing SECRET_HANDOFF_STORE=redis"; \
	grep -q '^HOOMI_API_BASE_URL=https://' "$$env" || missing="$$missing HOOMI_API_BASE_URL=https://..."; \
	[ -z "$$missing" ] || { echo ".env is missing for production:$$missing (make sdk-pin writes the SDK pair)"; exit 1; }

install: ## Install dependencies from package-lock.json
	@cd "$(ROOT)" && npm ci --no-audit --no-fund

test: ## Run the test suite (requires npm dependencies)
	@cd "$(ROOT)" && npm test

typecheck: ## Type-check source and tests (requires npm dependencies)
	@cd "$(ROOT)" && npm run typecheck

build: ## Compile the MCP server (requires npm dependencies)
	@cd "$(ROOT)" && npm run build

up: check-docker check-env check-workspace ## Start workspace MCP and Redis (development by default)
	@$(COMPOSE) up -d --wait hoomi-mcp
	@echo "Hoomi MCP: http://localhost:8300"

down: check-docker check-workspace ## Stop and remove MCP only; leave Redis and its data intact
	@$(COMPOSE) rm -sf hoomi-mcp

restart: check-docker check-workspace ## Restart the workspace MCP
	@$(COMPOSE) restart hoomi-mcp

logs: check-docker check-workspace ## Follow workspace MCP logs
	@$(COMPOSE) logs -f --tail=100 hoomi-mcp

ps: check-docker check-workspace ## Show workspace MCP and Redis status
	@$(COMPOSE) ps hoomi-mcp redis

check-docker:
	@docker info >/dev/null 2>&1 || { echo "Docker Engine is not running on context $(DOCKER_CONTEXT)"; exit 1; }

check-env:
	@[ -f "$(ROOT)/.env" ] || { echo "Missing .env: copy .env.example to .env and configure it"; exit 1; }

check-workspace:
	@[ -f "$(WORKSPACE)/compose.yaml" ] || { echo "Workspace compose.yaml not found at $(WORKSPACE): set WORKSPACE=/path/to/workspace"; exit 1; }
