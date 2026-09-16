# ============================================================
# Stage 1: Build
# ============================================================
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application (esbuild bundle → dist/)
RUN npm run build

# ============================================================
# Stage 2: Production
# ============================================================
FROM node:20-alpine AS production

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy package files and install production-only deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built application from build stage
COPY --from=build /app/dist ./dist

# Copy migrations for the standalone migrate script
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/src/scripts/migrate.js ./src/scripts/migrate.js

# Environment defaults (overridden by docker-compose or ECS task definition)
ENV NODE_ENV=production
ENV PORT=5001

EXPOSE 5001

# Health check - hits /api/healthz
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:5001/api/healthz || exit 1

# Start the server
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
