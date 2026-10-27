# Hoomi MCP: workspace development service and local checks.
# For the full local E2B stack, run `make start` from the workspace root.
# This Makefile does not configure a production deployment.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
WORKSPACE ?= $(abspath $(ROOT)/..)
export DOCKER_CONTEXT ?= default
export MCP_NODE_ENV ?= development
COMPOSE := docker compose --project-directory "$(WORKSPACE)" -f "$(WORKSPACE)/compose.yaml"

.PHONY: help install test typecheck build up down restart logs ps check-docker check-env check-workspace

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  make %-10s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

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
