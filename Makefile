# ABOUTME: Makefile for the-lucky-chamber service operations
# ABOUTME: Provides standard commands for development, testing, and deployment

.PHONY: help install dev dev-backend dev-frontend test test-quick lint clean clean-all docker-build up down logs status restart health shell build build-backend build-frontend deploy quick-check

# Configuration
ENV ?= local
SERVICE_NAME = the-lucky-chamber
CONTAINER_NAME = lucky_chamber_$(ENV)

# Set compose file and environment based on ENV
# PROJECT_NAME is CRITICAL for isolating docker-compose operations per environment
ifeq ($(ENV),local)
    PROJECT_NAME = $(SERVICE_NAME)_local
    COMPOSE_FILE = -p $(PROJECT_NAME) -f docker-compose.local.yml
    DOCKER_ENV = ENVIRONMENT=local
endif
ifeq ($(ENV),dev)
    PROJECT_NAME = $(SERVICE_NAME)_dev
    COMPOSE_FILE = -p $(PROJECT_NAME) -f docker-compose.dev.yml
    DOCKER_ENV = ENVIRONMENT=dev
endif
ifeq ($(ENV),prod)
    PROJECT_NAME = $(SERVICE_NAME)_prod
    COMPOSE_FILE = -p $(PROJECT_NAME) -f docker-compose.prod.yml
    DOCKER_ENV = ENVIRONMENT=prod
endif

help:
	@echo "Available commands:"
	@echo "  make install       - Install dependencies"
	@echo "  make dev           - Run development servers (backend + frontend)"
	@echo "  make dev-backend   - Run backend only"
	@echo "  make dev-frontend  - Run frontend only"
	@echo "  make test          - Run tests with coverage"
	@echo "  make test-quick    - Run tests without coverage"
	@echo "  make lint          - Lint code"
	@echo "  make clean         - Clean cache and temp files"
	@echo "  make up ENV=local  - Start service in Docker"
	@echo "  make down ENV=local - Stop service"
	@echo "  make logs ENV=local - View service logs"
	@echo "  make deploy ENV=prod - Deploy to environment"

install:
	npm install
	npm install --prefix backend
	npm install --prefix frontend
	npm install --prefix shared

dev:
	npm run dev

dev-backend:
	npm run dev:backend

dev-frontend:
	npm run dev:frontend

test:
	cd backend && npm run test:coverage
	cd frontend && npm run test:coverage

test-quick:
	cd backend && npm test
	cd frontend && npm run test:run

lint:
	npm run lint

lint-backend:
	npm run lint:backend

lint-frontend:
	npm run lint:frontend

clean:
	rm -rf backend/dist
	rm -rf frontend/.next
	rm -rf frontend/out
	rm -rf coverage

clean-all: clean
	rm -rf node_modules
	rm -rf backend/node_modules
	rm -rf frontend/node_modules
	rm -rf shared/node_modules

docker-build:
	docker build -t kasanova-$(CONTAINER_NAME):latest .

up:  ## Start services
	export $(DOCKER_ENV) && docker compose $(COMPOSE_FILE) up -d

down:  ## Stop services
	export $(DOCKER_ENV) && docker compose $(COMPOSE_FILE) down

logs:  ## View logs
	export $(DOCKER_ENV) && docker compose $(COMPOSE_FILE) logs -f -n100

status:  ## Check status
	export $(DOCKER_ENV) && docker compose $(COMPOSE_FILE) ps

restart: down up  ## Restart services

health:  ## Check health
	@curl -s http://localhost:4200/health | jq || echo "Service not healthy"

shell:  ## Open shell in container
	docker exec -it $(CONTAINER_NAME) /bin/sh

build:
	npm run build

build-backend:
	npm run build:backend

build-frontend:
	npm run build:frontend

deploy:
	@echo "Deploying $(SERVICE_NAME) to $(ENV) environment..."
	./scripts/deploy.sh $(ENV)

# Quick check before committing
quick-check: lint test-quick
	@echo "✅ All checks passed"
