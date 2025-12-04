"""
Nooterra Python SDK

Build and deploy AI agents on the Nooterra network.

Sync client:
    from nooterra import NooterraClient
    client = NooterraClient(coordinator_url="https://coord.nooterra.ai")
    workflow = client.publish_task("Summarize this text", budget=5)

Async client:
    from nooterra import AsyncNooterraClient
    async with AsyncNooterraClient(...) as client:
        workflow = await client.create_workflow("text.summarize", {"text": "..."})

Agent server:
    from nooterra import NooterraAgent
    agent = NooterraAgent(did="did:noot:my-agent", secret_key="...")
    
    @agent.capability("text.summarize")
    def summarize(input_data, ctx):
        return {"summary": "..."}
    
    agent.run(port=8080)

Protocol APIs:
    from nooterra import ProtocolClient
    protocol = ProtocolClient(coordinator_url="https://coord.nooterra.ai")
    protocol.check_revoked("did:noot:some-agent")
"""

from .client import NooterraClient, NooterraError
from .protocol import ProtocolClient
from .agent import NooterraAgent, Capability, TaskContext, create_agent

# Async client requires aiohttp
try:
    from .async_client import AsyncNooterraClient, AsyncNooterraError
except ImportError:
    AsyncNooterraClient = None  # type: ignore
    AsyncNooterraError = None  # type: ignore

__version__ = "0.2.0"

__all__ = [
    # Sync client
    "NooterraClient",
    "NooterraError",
    # Async client
    "AsyncNooterraClient",
    "AsyncNooterraError",
    # Protocol client
    "ProtocolClient",
    # Agent framework
    "NooterraAgent",
    "Capability",
    "TaskContext",
    "create_agent",
    # Integrations (lazy-loaded via nooterra.integrations)
    "integrations",
]

# Lazy import for integrations submodule
def __getattr__(name: str):
    if name == "integrations":
        from . import integrations
        return integrations
    raise AttributeError(f"module 'nooterra' has no attribute '{name}'")

