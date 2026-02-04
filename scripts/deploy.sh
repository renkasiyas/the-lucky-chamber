#!/bin/bash
# ABOUTME: Standardized deployment script for the-lucky-chamber service
# ABOUTME: Handles deployment, status checks, and logging across environments

set -euo pipefail

# Service-specific configuration
SERVICE_NAME="the-lucky-chamber"
CONTAINER_PREFIX="lucky_chamber"
HEALTH_ENDPOINT="/api/health"

# Configuration
ENV=${1:-local}
ACTION=${2:-deploy}

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"; }
error() { echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"; }

# Set environment-specific configuration
# PROJECT_NAME ensures docker compose commands only affect containers from the same environment
case "$ENV" in
    local)
        PROJECT_NAME="${SERVICE_NAME}_local"
        COMPOSE_FILES="-p ${PROJECT_NAME} -f docker-compose.local.yml"
        DOCKER_ENV="ENVIRONMENT=local"
        CONTAINER_NAME="${CONTAINER_PREFIX}_local"
        HEALTH_PORT="4201"
        ENV_FILE="backend/.env.local"
        ;;
    dev)
        PROJECT_NAME="${SERVICE_NAME}_dev"
        COMPOSE_FILES="-p ${PROJECT_NAME} -f docker-compose.dev.yml"
        DOCKER_ENV="ENVIRONMENT=dev"
        CONTAINER_NAME="${CONTAINER_PREFIX}_dev"
        HEALTH_PORT="4201"
        ENV_FILE="backend/.env.dev"
        ;;
    prod)
        PROJECT_NAME="${SERVICE_NAME}_prod"
        COMPOSE_FILES="-p ${PROJECT_NAME} -f docker-compose.prod.yml"
        DOCKER_ENV="ENVIRONMENT=prod"
        CONTAINER_NAME="${CONTAINER_PREFIX}_prod"
        HEALTH_PORT="4201"
        ENV_FILE="backend/.env.prod"
        ;;
    *)
        error "Unknown environment: $ENV"
        echo "Available environments: local, dev, prod"
        exit 1
        ;;
esac

# Build health URL
HEALTH_URL="http://localhost:${HEALTH_PORT}${HEALTH_ENDPOINT}"

# Ensure shared network exists (for all envs)
ensure_network() {
    if [ -z "$(docker network ls -q -f name=^lucky_chamber_internal$)" ]; then
        docker network create --driver bridge lucky_chamber_internal
        log "Created lucky_chamber_internal network"
    fi
}

# Health check function
check_health() {
    local url=$1
    local max_attempts=30
    local attempt=0

    log "Waiting for backend to be healthy..."

    while [ $attempt -lt $max_attempts ]; do
        # Check health endpoint
        if curl -sf "$url" > /dev/null 2>&1; then
            log "✅ Backend is healthy!"
            return 0
        fi

        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done

    error "Backend failed to become healthy after $max_attempts attempts"
    return 1
}

# Main actions
case "$ACTION" in
    deploy)
        log "Deploying $SERVICE_NAME to $ENV environment..."
        log "Using project name: $PROJECT_NAME"

        # Ensure network exists
        ensure_network

        # Export environment
        export $DOCKER_ENV

        # Load env file if exists
        if [ -f "$ENV_FILE" ]; then
            log "Using env file: $ENV_FILE"
            set -a
            source "$ENV_FILE"
            set +a
        fi

        # Build and start services
        log "Building Docker images..."
        docker compose $COMPOSE_FILES build --no-cache

        log "Stopping existing containers..."
        docker compose $COMPOSE_FILES down --remove-orphans 2>/dev/null || true

        log "Starting services..."
        docker compose $COMPOSE_FILES up -d

        # Check health
        if ! check_health "$HEALTH_URL"; then
            error "$SERVICE_NAME failed to become healthy"
            docker compose $COMPOSE_FILES logs
            exit 1
        fi

        log "✅ Deployment successful!"

        # Show status
        docker compose $COMPOSE_FILES ps

        # Show recent logs
        log "Recent logs from $SERVICE_NAME:"
        docker compose $COMPOSE_FILES logs --tail 10 2>/dev/null || true
        ;;

    status)
        log "Checking status for $ENV environment..."
        export $DOCKER_ENV
        docker compose $COMPOSE_FILES ps

        # Check health
        if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
            curl -sf "$HEALTH_URL" | jq . || true
        else
            warn "$SERVICE_NAME health check failed or not responding"
        fi
        ;;

    logs)
        log "Showing logs for $ENV environment..."
        export $DOCKER_ENV
        docker compose $COMPOSE_FILES logs -f --tail=100
        ;;

    stop)
        log "Stopping $SERVICE_NAME in $ENV environment..."
        log "Using project name: $PROJECT_NAME"
        export $DOCKER_ENV
        docker compose $COMPOSE_FILES down
        log "✅ Services stopped"
        ;;

    restart)
        log "Restarting $SERVICE_NAME in $ENV environment..."
        $0 "$ENV" stop
        sleep 2
        $0 "$ENV" deploy
        ;;

    *)
        error "Unknown action: $ACTION"
        echo "Usage: $0 [local|dev|prod] [deploy|status|logs|stop|restart]"
        echo ""
        echo "Actions:"
        echo "  deploy  - Build and deploy the service"
        echo "  status  - Check service status and health"
        echo "  logs    - Show service logs"
        echo "  stop    - Stop the service"
        echo "  restart - Restart the service"
        exit 1
        ;;
esac
