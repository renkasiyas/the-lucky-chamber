# ABOUTME: Dockerfile for The Lucky Chamber frontend
# ABOUTME: Multi-stage build for Next.js application

FROM node:22-slim AS base

# Set working directory to match repo structure
WORKDIR /build

# Dependencies stage
FROM base AS deps

# Copy shared types (required for TypeScript compilation)
COPY shared/ ./shared/

# Copy frontend package files
COPY frontend/package*.json ./frontend/

WORKDIR /build/frontend
RUN npm ci

# Builder stage
FROM base AS builder

# Copy shared types
COPY shared/ ./shared/

# Copy deps
COPY --from=deps /build/frontend/node_modules ./frontend/node_modules
COPY frontend/ ./frontend/

WORKDIR /build/frontend

# Set build-time environment variables
ENV NEXT_TELEMETRY_DISABLED=1

# Build the application
RUN npm run build

# Production stage
FROM node:22-slim AS production
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy only necessary files for production
COPY --from=builder /build/frontend/public ./public
COPY --from=builder --chown=nextjs:nodejs /build/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /build/frontend/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
