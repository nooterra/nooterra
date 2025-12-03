# Secure sandbox for code verification
# Multi-stage build for minimal attack surface

# Build stage
FROM node:20-alpine AS builder

WORKDIR /build

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN pnpm build

# Production stage - minimal image
FROM node:20-alpine AS production

# Security: Create non-root user
RUN addgroup -g 1001 -S sandbox && \
    adduser -u 1001 -S sandbox -G sandbox

# Security: Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy only production files
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./

# Create temp directory with restricted permissions
RUN mkdir -p /tmp/nooterra-sandbox && \
    chown sandbox:sandbox /tmp/nooterra-sandbox && \
    chmod 700 /tmp/nooterra-sandbox

# Security: Set environment
ENV NODE_ENV=production
ENV SANDBOX_MODE=strict
ENV TEMP_DIR=/tmp/nooterra-sandbox

# Security: Switch to non-root user
USER sandbox

# Expose port
EXPOSE 4005

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:4005/health').then(r => r.ok ? process.exit(0) : process.exit(1))" || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start server
CMD ["node", "dist/server.js"]
