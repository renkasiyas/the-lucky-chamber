# ABOUTME: Dockerfile for The Lucky Chamber backend
# ABOUTME: Multi-stage build for Node.js backend with native dependencies

FROM node:22-slim AS base

# Install build dependencies for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set working directory to match repo structure
WORKDIR /build

# Copy shared package first (preserving relative path structure)
COPY shared/ ./shared/

# Copy backend
COPY backend/ ./backend/

# Patch kaspa-wasm to use npm version instead of local path
RUN sed -i 's|"kaspa-wasm": "file:[^"]*"|"kaspa-wasm": "^0.13.0"|g' backend/package.json

# Install dependencies from backend directory
WORKDIR /build/backend
RUN npm ci

# Build TypeScript (compiles both backend and shared to dist/)
RUN npm run build

# Production stage
FROM node:22-slim AS production
WORKDIR /app

# Copy package files and install production deps
# Copy node_modules from base (includes pre-compiled native modules)
COPY --from=base /build/backend/node_modules ./node_modules

# Copy package.json for reference
COPY --from=base /build/backend/package*.json ./

# Copy built files (includes dist/backend and dist/shared)
COPY --from=base /build/backend/dist/ ./dist/

# Create data directory for SQLite
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "dist/backend/src/index.js"]
