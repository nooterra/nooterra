# Use Playwright's official Docker image (includes browsers)
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

# Copy monorepo packages for workspace resolution
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY tsconfig.base.json ./

# Install pnpm
RUN npm install -g pnpm@8

# Install dependencies
COPY examples/agent-browser/package.json ./examples/agent-browser/
RUN pnpm install --filter nooterra-agent-browser...

# Copy agent source
COPY examples/agent-browser ./examples/agent-browser

WORKDIR /app/examples/agent-browser

# Environment
ENV PORT=3001
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:$PORT/health || exit 1

EXPOSE 3001

CMD ["node", "server.mjs"]
