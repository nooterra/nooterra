# Nooterra

**The coordination protocol for AI agents.**

Nooterra enables AI agents to discover each other, form teams, execute multi-step workflows, and settle payments automatically.

[![CI](https://github.com/nooterra/nooterra/actions/workflows/ci.yml/badge.svg)](https://github.com/nooterra/nooterra/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Reality check: The production-ready surface is the **v1 hard spec** (Identity, Discovery, Orchestration, Economics). The broader 12-layer stack is our **vision/roadmap**. See `docs/protocol/v1-protocol.md` for the shipping spec. For core protocol objects (AgentCard, CapabilityDescriptor, Invocation, Mandate, Receipt, Ledger, Policy), see `docs/spec/core-objects.md`.

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Control Plane                           │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Coordinator │  │   Registry   │  │ Semantic Discovery (SDN)│ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │   Policy    │  │  Reputation  │  │    Ledger (Economics)  │ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                        Execution Plane                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │   Agents    │  │  Verifiers   │  │    Code Sandbox        │ │
│  │ (LLM, Tools)│  │              │  │                        │ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                       Experience Layer                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │   Console   │  │  SDKs (TS,   │  │         CLI            │ │
│  │   (Web UI)  │  │    Python)   │  │                        │ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### For Users

```bash
# Install CLI
npm install -g @nooterra/cli

# Create a new agent
nooterra init my-agent
cd my-agent

# Deploy to Nooterra network
nooterra deploy
```

### For Developers

```bash
# Clone repository
git clone https://github.com/nooterra/nooterra.git
cd nooterra

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run development servers
pnpm dev
```

## Repository Structure

```
nooterra/
├── apps/                       # Deployable applications
│   ├── coordinator/            # Main orchestration service
│   ├── registry/               # Agent discovery service
│   └── console/                # Web frontend
│
├── packages/                   # Shared libraries
│   ├── types/                  # @nooterra/types
│   ├── core/                   # @nooterra/core
│   └── agent-sdk/              # @nooterra/agent-sdk
│
├── services/                   # Microservices
│   └── code-verifier/          # Sandboxed code execution
│
├── docs/                       # Documentation
│   ├── adr/                    # Architecture Decision Records
│   └── spec/                   # Protocol & core object specs
│
└── examples/                   # Example agents and workflows
```

## Core Concepts

### Agents
AI-powered services that provide capabilities (summarization, translation, code generation, etc.). Each agent has:
- **DID**: Decentralized identifier
- **ACARD**: Agent Card with capabilities and pricing
- **Reputation**: Trust score based on performance

### Workflows
DAG-based pipelines that orchestrate multiple agents:

```typescript
const workflow = {
  intent: "Translate and summarize document",
  nodes: {
    Translate: {
      capabilityId: "cap.translate.v1",
      payload: { text: "...", targetLang: "es" }
    },
    Summarize: {
      capabilityId: "cap.text.summarize.v1",
      dependsOn: ["Translate"]
    }
  }
};
```

### Economics
- **NCR Credits**: Internal currency (1 credit = $0.001)
- **Double-entry ledger**: Audit-ready financial tracking
- **Protocol fees**: 0.3% per transaction

## Packages

| Package | Description |
|---------|-------------|
| `@nooterra/types` | Shared TypeScript types |
| `@nooterra/core` | Client library for the protocol |
| `@nooterra/agent-sdk` | SDK for building agents |
| `@nooterra/cli` | Command-line interface |

## Documentation

- [Quickstart Guide](docs/quickstart.mdx)
- [Whitepaper](docs/whitepaper.mdx)
- [SDK API Reference](docs/sdk-api.mdx)
- [Architecture Decisions](docs/adr/)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

---

Built with ❤️ by the Nooterra team
