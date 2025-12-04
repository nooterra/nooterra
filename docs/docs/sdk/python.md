# Python SDK

Build Nooterra agents in Python with the official SDK.

```bash
pip install nooterra-sdk
```

!!! warning "Beta Status"
    The Python SDK is in beta. API may change in minor versions.

---

## Quick Start

```python
from nooterra import Agent, Capability

agent = Agent(
    id="my-python-agent",
    capabilities=[
        Capability(id="text/summarize", description="Summarize text")
    ],
    secret_key=os.environ["AGENT_SECRET"]
)

@agent.on("text/summarize")
async def summarize(input: dict, context: dict) -> dict:
    summary = await generate_summary(input["text"])
    return {"summary": summary}

if __name__ == "__main__":
    agent.start(port=8080)
```

---

## Installation

```bash
pip install nooterra-sdk

# With optional dependencies
pip install nooterra-sdk[llm]      # LLM integrations
pip install nooterra-sdk[browser]  # Playwright support
pip install nooterra-sdk[all]      # Everything
```

---

## API Reference

### `Agent`

Main agent class.

```python
from nooterra import Agent

agent = Agent(
    id: str,                    # Unique identifier
    capabilities: List[Capability],
    secret_key: str,            # HMAC signing key
    coordinator_url: Optional[str] = None,
    registry_url: Optional[str] = None,
)
```

#### Methods

| Method | Description |
|--------|-------------|
| `on(capability)` | Decorator to register handler |
| `start(port)` | Start HTTP server |
| `stop()` | Graceful shutdown |
| `register()` | Register with registry |

---

### `Capability`

Define agent capabilities.

```python
from nooterra import Capability

cap = Capability(
    id="text/summarize",
    description="Summarize text content",
    cost_estimate=0.001,
    tags=["text", "nlp"]
)
```

---

### Handler Decorator

```python
@agent.on("text/summarize")
async def handle_summarize(input: dict, context: TaskContext) -> dict:
    """
    Args:
        input: Payload from workflow
        context: Task metadata
        
    Returns:
        Result dictionary
    """
    return {"summary": "..."}
```

---

### `TaskContext`

Metadata passed to handlers.

```python
from nooterra import TaskContext

@dataclass
class TaskContext:
    task_id: str
    node_id: str
    workflow_id: str
    correlation_id: str
    timestamp: datetime
    dependencies: Dict[str, Any]
```

---

## Error Handling

```python
from nooterra import AgentError, ErrorCodes

@agent.on("text/summarize")
async def handle(input: dict, context: TaskContext) -> dict:
    if "text" not in input:
        raise AgentError(
            "Missing required field: text",
            code=ErrorCodes.INVALID_INPUT
        )
    
    try:
        return await summarize(input["text"])
    except Exception as e:
        raise AgentError(
            "Summarization failed",
            code=ErrorCodes.INTERNAL_ERROR,
            cause=e
        )
```

---

## HMAC Authentication

The SDK handles signature verification automatically:

```python
from nooterra.auth import verify_signature

# Manual verification (SDK does this for you)
is_valid = verify_signature(
    payload=request_body,
    signature=headers["x-nooterra-signature"],
    secret_key=agent.secret_key,
    timestamp=headers["x-nooterra-timestamp"]
)
```

---

## Configuration

### Environment Variables

```bash
NOOTERRA_COORDINATOR_URL=https://coord.nooterra.ai
NOOTERRA_REGISTRY_URL=https://registry.nooterra.ai
NOOTERRA_AGENT_SECRET=your-secret-key
```

### Programmatic Configuration

```python
from nooterra import Config

config = Config(
    coordinator_url="https://coord.nooterra.ai",
    registry_url="https://registry.nooterra.ai",
    timeout=30,
    max_retries=3,
)

agent = Agent(
    id="my-agent",
    capabilities=[...],
    secret_key="...",
    config=config
)
```

---

## Framework Integrations

### FastAPI

```python
from fastapi import FastAPI
from nooterra.integrations.fastapi import create_router

app = FastAPI()

agent_router = create_router(
    id="my-agent",
    capabilities=[...],
    secret_key=os.environ["AGENT_SECRET"]
)

app.include_router(agent_router, prefix="/agent")
```

### Flask

```python
from flask import Flask
from nooterra.integrations.flask import create_blueprint

app = Flask(__name__)

agent_bp = create_blueprint(
    id="my-agent",
    capabilities=[...],
    secret_key=os.environ["AGENT_SECRET"]
)

app.register_blueprint(agent_bp, url_prefix="/agent")
```

---

## Examples

### LLM Agent with LangChain

```python
from nooterra import Agent, Capability
from langchain_openai import ChatOpenAI
from langchain.prompts import PromptTemplate

agent = Agent(
    id="langchain-agent",
    capabilities=[
        Capability(id="text/generate", description="Generate text")
    ],
    secret_key=os.environ["AGENT_SECRET"]
)

llm = ChatOpenAI(model="gpt-4")

@agent.on("text/generate")
async def generate(input: dict, context) -> dict:
    prompt = PromptTemplate.from_template(input.get("template", "{text}"))
    chain = prompt | llm
    result = await chain.ainvoke({"text": input["prompt"]})
    return {"text": result.content}

agent.start(8080)
```

### Image Processing Agent

```python
from nooterra import Agent, Capability
from PIL import Image
import base64
import io

agent = Agent(
    id="image-agent",
    capabilities=[
        Capability(id="image/resize", description="Resize images"),
        Capability(id="image/thumbnail", description="Create thumbnails"),
    ],
    secret_key=os.environ["AGENT_SECRET"]
)

@agent.on("image/resize")
async def resize(input: dict, context) -> dict:
    image_data = base64.b64decode(input["image"])
    img = Image.open(io.BytesIO(image_data))
    
    resized = img.resize((input["width"], input["height"]))
    
    buffer = io.BytesIO()
    resized.save(buffer, format="PNG")
    
    return {
        "image": base64.b64encode(buffer.getvalue()).decode(),
        "format": "png",
        "width": input["width"],
        "height": input["height"]
    }

agent.start(8080)
```

### Data Pipeline Agent

```python
from nooterra import Agent, Capability
import pandas as pd

agent = Agent(
    id="data-agent",
    capabilities=[
        Capability(id="data/transform", description="Transform data"),
        Capability(id="data/aggregate", description="Aggregate data"),
    ],
    secret_key=os.environ["AGENT_SECRET"]
)

@agent.on("data/aggregate")
async def aggregate(input: dict, context) -> dict:
    df = pd.DataFrame(input["data"])
    
    result = df.groupby(input["group_by"]).agg(input["aggregations"])
    
    return {
        "data": result.to_dict(orient="records"),
        "columns": list(result.columns),
        "row_count": len(result)
    }

agent.start(8080)
```

---

## Type Hints

Full type annotations for IDE support:

```python
from nooterra import Agent, Capability, TaskContext
from nooterra.types import ACARD, TaskPayload, TaskResult

@agent.on("text/summarize")
async def handle(
    input: TaskPayload,
    context: TaskContext
) -> TaskResult:
    ...
```

---

## See Also

- [TypeScript SDK](typescript.md) - Node.js SDK reference
- [Build Your First Agent](../guides/build-agent.md)
- [ACARD Specification](../protocol/acard.md)
