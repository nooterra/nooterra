# @nooterra/code-verifier

Sandboxed code verification service for the Nooterra protocol.

## Overview

This service executes user-provided JavaScript/TypeScript code with optional tests in a restricted sandbox environment. It's used by the coordinator to verify agent-generated code.

## Features

- **Container Isolation**: Runs in a minimal Docker container
- **Process Sandboxing**: Restricted Node.js execution environment
- **Pattern Blocking**: Detects and blocks dangerous code patterns
- **Resource Limits**: CPU, memory, and time limits
- **No Network**: Sandbox has no network access
- **Non-root**: Runs as unprivileged user

## API

### POST /verify

Execute code with optional tests.

**Request:**
```json
{
  "language": "javascript",
  "code": "function add(a, b) { return a + b; }",
  "tests": "console.assert(add(1, 2) === 3, 'add works');",
  "context": { "nodeId": "Generate_1" }
}
```

**Response:**
```json
{
  "ok": true,
  "status": "passed",
  "metrics": {
    "latencyMs": 45,
    "memoryUsedBytes": 1024000
  },
  "data": {
    "stdout": "",
    "stderr": "",
    "exitCode": 0
  },
  "verifier": "cap.verify.code.tests.v1",
  "executionId": "abc123xyz"
}
```

### GET /health

Health check endpoint.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4005 | Server port |
| `SANDBOX_MODE` | dev | `dev` or `strict` |
| `EXEC_TIMEOUT_MS` | 5000 | Max execution time |
| `MEMORY_LIMIT_MB` | 128 | Max memory |
| `MAX_CODE_BYTES` | 65536 | Max code size |

## Security

### Blocked Patterns

The following are blocked in submitted code:

- `require('fs')`, `require('child_process')`, etc.
- `import` from Node.js built-ins
- `process.exit`, `process.kill`, `process.env`
- `eval()`, `new Function()`

### Container Security

- Non-root user
- Read-only filesystem (except /tmp)
- No network access (in strict mode)
- Resource limits enforced
- Signal handling with dumb-init

## Development

```bash
# Install dependencies
pnpm install

# Run in development
pnpm dev

# Build
pnpm build

# Run tests
pnpm test
```

## Docker

```bash
# Build
docker build -t nooterra/code-verifier .

# Run
docker run -p 4005:4005 \
  -e SANDBOX_MODE=strict \
  --read-only \
  --tmpfs /tmp:noexec,nosuid,size=100m \
  --security-opt=no-new-privileges \
  --cap-drop=ALL \
  nooterra/code-verifier
```
