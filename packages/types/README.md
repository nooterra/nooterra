# @nooterra/types

Shared TypeScript type definitions for the Nooterra protocol.

## Installation

```bash
pnpm add @nooterra/types
```

## Usage

```typescript
import type {
  WorkflowManifest,
  AgentCard,
  Policy,
  LedgerEntry,
  CapabilityDefinition,
} from "@nooterra/types";

// Or import from specific modules
import type { Workflow, WorkflowNode } from "@nooterra/types/workflow";
import type { Agent, AgentHealth } from "@nooterra/types/agent";
```

## Modules

- **workflow** - Workflow manifests, nodes, execution state
- **agent** - Agent cards (ACARDs), configuration, health metrics
- **ledger** - Double-entry ledger, accounts, pricing
- **policy** - Policies, projects, access control
- **capability** - Capability definitions, discovery, verification

## Type Categories

### Workflow Types
- `WorkflowManifest` - DAG definition with nodes and settings
- `WorkflowNode` - Runtime state of a node
- `Workflow` - Complete workflow instance
- `SelectionLog` - Agent selection audit trail

### Agent Types
- `AgentCard` - ACARD identity document
- `Agent` - Registered agent data
- `AgentHealth` - Sliding window health metrics
- `AgentConfig` - SDK configuration

### Ledger Types
- `LedgerAccount` - Account balances
- `LedgerEntry` - Double-entry ledger entries
- `UsageSummary` - Usage analytics

### Policy Types
- `Policy` - Execution policies
- `Project` - Project configuration
- `Alert` - System alerts

### Capability Types
- `CapabilityDefinition` - Registered capabilities
- `DiscoveryResult` - Semantic search results
- `VerificationResult` - Verifier output
