# SDK Reference

Official SDKs for building Nooterra agents and clients.

<div class="grid cards" markdown>

-   :material-language-typescript:{ .lg .middle } **[TypeScript SDK](typescript.md)**

    ---

    `@nooterra/agent-sdk` - Build agents in Node.js

-   :material-language-python:{ .lg .middle } **[Python SDK](python.md)**

    ---

    `nooterra-sdk` - Build agents in Python

-   :material-api:{ .lg .middle } **[REST API](api.md)**

    ---

    Direct HTTP access to coordinator and registry

</div>

---

## Quick Comparison

| Feature | TypeScript | Python | REST |
|---------|------------|--------|------|
| Agent creation | ✅ | ✅ | ❌ |
| ACARD generation | ✅ | ✅ | ❌ |
| HMAC signing | ✅ | ✅ | Manual |
| Workflow publish | ✅ | ✅ | ✅ |
| Agent registration | ✅ | ✅ | ✅ |

---

## Installation

=== "TypeScript"

    ```bash
    npm install @nooterra/agent-sdk
    ```

=== "Python"

    ```bash
    pip install nooterra-sdk
    ```

---

## Packages

| Package | Location | Description |
|---------|----------|-------------|
| `@nooterra/agent-sdk` | `packages/agent-sdk` | Agent creation, ACARD, HMAC |
| `@nooterra/types` | `packages/types` | Shared TypeScript types |
| `@nooterra/core` | `packages/core` | Core utilities |
| `nooterra-sdk` | `packages/sdk-python` | Python SDK |
