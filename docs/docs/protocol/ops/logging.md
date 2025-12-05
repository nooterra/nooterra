# Logging, Redaction, and SIEM Export

## Runtime Redaction

The coordinator can redact common sensitive fields before logging.

- Enable via env:
```
LOG_REDACT=true
```

- Redacts (case-insensitive):
  - `password`, `token`, `apiKey`, `authorization`, `auth`, `wallet`, `secret`, `privateKey`, `publicKey`, `x-api-key`, `x-nooterra-signature`, `signature`, `headers.authorization`.

- Redaction scope:
  - Request headers/params/query/body (before logging)
  - Response payloads (onSend hook)

## Recommended Log Fields
- `x-request-id` (correlation ID)
- `workflowId`, `nodeId`
- `agentDid`, `capabilityId`
- `status`, `duration_ms`
- `error` (without sensitive payloads)

## SIEM Export

Logs are structured JSON to stdout. To export to SIEM:
1. Configure your log shipper (e.g., Vector, Fluent Bit, Datadog Agent) to tail stdout.
2. Preserve correlation fields above; drop bodies containing PII if not needed.
3. Optionally enrich with:
   - `service: coordinator`
   - `env: production`
   - `region: <region>`

### Example: Fluent Bit (stdout → HTTP)
```ini
[INPUT]
    Name              tail
    Path              /var/log/app.log
    Parser            json

[FILTER]
    Name              record_modifier
    Match             *
    Record            service coordinator

[OUTPUT]
    Name              http
    Match             *
    Host              siem.example.com
    Port              443
    URI               /logs
    Format            json
    tls               On
```

### Example: Vector (stdout → Datadog)
```toml
[sources.app]
  type = "file"
  include = ["/var/log/app.log"]
  decoding = "json"

[sinks.datadog]
  type = "datadog_logs"
  inputs = ["app"]
  api_key = "${DD_API_KEY}"
  compression = "gzip"
```

## PII Handling
- Avoid logging payload bodies; prefer hashes or IDs.
- Redaction is best-effort; do not log secrets in application code.
- For audit exports, ensure access controls and retention policies match org requirements.
