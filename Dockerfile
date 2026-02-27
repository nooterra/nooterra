FROM node:20-bookworm-slim AS deps

WORKDIR /app
COPY package*.json ./
COPY NOOTERRA_VERSION ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --ignore-scripts; else npm install --omit=dev --no-audit --no-fund --ignore-scripts; fi && npm cache clean --force

FROM node:20-bookworm-slim AS prep
RUN mkdir -p /data && chown -R 65532:65532 /data

FROM gcr.io/distroless/nodejs20-debian12:nonroot AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV HOME=/tmp

ARG NOOTERRA_VERSION=0.0.0
ARG GIT_SHA=unknown

# Expose build metadata to the API (x-nooterra-build) and to operators.
ENV NOOTERRA_VERSION=$NOOTERRA_VERSION
ENV PROXY_BUILD=$GIT_SHA

LABEL org.opencontainers.image.title="nooterra"
LABEL org.opencontainers.image.version=$NOOTERRA_VERSION
LABEL org.opencontainers.image.revision=$GIT_SHA

# Copy dependencies first for better layer caching.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/NOOTERRA_VERSION ./NOOTERRA_VERSION

# Runtime-writable locations should be mounted as volumes in k8s; copy with nonroot ownership for distroless runtime.
COPY --chown=65532:65532 --from=prep /data /data

# Copy application code.
COPY src ./src
COPY packages ./packages
COPY services ./services
COPY docs/pilot-kit ./docs/pilot-kit

EXPOSE 3000

# Distroless node image uses "node" as the entrypoint.
CMD ["src/api/server.js"]
