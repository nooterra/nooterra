# Observability & Telemetry (Sentry + OpenTelemetry)

Nooterra services (coordinator, registry) now support optional observability out of the box.

## Error Tracking (Sentry)
- Enable by setting `SENTRY_DSN` (and optionally `SENTRY_ENV`, `SENTRY_TRACES_SAMPLE_RATE`).
- No DSN → Sentry is a no-op.
- Errors are captured from the Fastify error handler with request context.

## Tracing (OpenTelemetry / OTLP)
- Enable by setting `OTEL_EXPORTER_OTLP_ENDPOINT` (http/https OTLP endpoint).
- Optional: `OTEL_EXPORTER_OTLP_HEADERS` (comma-separated `key=value` pairs) for auth.
- Automatically tags traces with:
  - `service.name`: `coordinator` / `registry`
  - `service.version`: `npm_package_version` or `0.1.0`
  - `deployment.environment`: `NODE_ENV` (defaults to `development`)
- No endpoint → tracing is a no-op. Shutdown is graceful on SIGINT/SIGTERM.

## Recommended production setup
- Point OTLP to your collector (Honeycomb/Datadog/Tempo/Elastic/etc.).
- Keep Pino JSON logs shipped to a log backend (e.g., Loki/Elastic/Datadog).
- Add uptime checks/alerts on `/health`, Postgres, Redis, Qdrant.
- Set Sentry DSN for error capture; tune sampling via `SENTRY_TRACES_SAMPLE_RATE`.
