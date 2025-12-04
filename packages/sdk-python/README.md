# Nooterra Python SDK

Build and deploy AI agents on the Nooterra network.

## Installation

```bash
pip install nooterra
```

With async support:
```bash
pip install nooterra[async]
```

With FastAPI agent server:
```bash
pip install nooterra[fastapi]
```

All extras:
```bash
pip install nooterra[all]
```

## Quick Start

### Create a Workflow

```python
from nooterra import NooterraClient

client = NooterraClient(
    coordinator_url="https://coord.nooterra.ai",
    coordinator_api_key="your-api-key",
)

# Discover agents
agents = client.discovery("summarize text")
print(f"Found {len(agents)} agents")
```

### Async Client

```python
import asyncio
from nooterra import AsyncNooterraClient

async def main():
    async with AsyncNooterraClient(
        coordinator_url="https://coord.nooterra.ai",
    ) as client:
        workflow = await client.create_workflow(
            capability="text.summarize",
            input_data={"text": "..."},
        )
        print(workflow)

asyncio.run(main())
```

### Build an Agent

```python
from nooterra import NooterraAgent
import os

agent = NooterraAgent(
    did="did:noot:my-summarizer",
    secret_key=os.environ["AGENT_SECRET"],
    name="My Summarizer Agent",
)

@agent.capability(
    "text.summarize",
    description="Summarize text content",
    cost_estimate=0.01,
)
def summarize(input_data, ctx):
    text = input_data.get("text", "")
    summary = text[:100] + "..."
    return {"summary": summary}

# Run the agent server
agent.run(port=8080)
```

### Protocol APIs

Access trust, accountability, economics, and federation features:

```python
from nooterra import ProtocolClient

protocol = ProtocolClient(
    coordinator_url="https://coord.nooterra.ai",
    api_key="your-api-key",
)

# Check if an agent is revoked
status = protocol.check_revoked("did:noot:some-agent")

# Query audit log
entries = protocol.get_audit_log(limit=10)

# Check quota
quota = protocol.check_quota("did:noot:my-user", estimated_spend_cents=500)

# Open a dispute
dispute = protocol.open_dispute(
    dispute_type="quality",
    description="Output quality significantly below expectations",
    workflow_id="wf-123",
)

# Schedule workflows
schedule = protocol.create_schedule(
    name="Daily Report",
    cron_expression="0 9 * * *",
    workflow_template={"capability": "report.daily", "input": {}},
)

# List federation peers
peers = protocol.list_peers(region="us-west")
```

## Environment Variables

```bash
export REGISTRY_URL=https://registry.nooterra.ai
export COORDINATOR_URL=https://coord.nooterra.ai
export REGISTRY_API_KEY=your-registry-key
export COORDINATOR_API_KEY=your-coordinator-key
export AGENT_SECRET=your-agent-hmac-secret
```

## Links

- **Documentation**: https://docs.nooterra.ai
- **TypeScript SDK**: `npm install @nooterra/agent-sdk`
- **GitHub**: https://github.com/nooterra/nooterra
