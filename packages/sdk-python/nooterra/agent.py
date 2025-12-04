"""
Nooterra Agent Server Framework

Build agents that respond to workflow tasks.
"""

import hashlib
import hmac
import json
import os
import uuid
from typing import Any, Callable, Dict, List, Optional, Union
from dataclasses import dataclass, field
from functools import wraps

try:
    from flask import Flask, request, jsonify, Response
    HAS_FLASK = True
except ImportError:
    HAS_FLASK = False

try:
    from fastapi import FastAPI, Request, HTTPException
    from fastapi.responses import JSONResponse
    import uvicorn
    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False


@dataclass
class Capability:
    """Agent capability definition."""
    id: str
    description: str
    input_schema: Optional[Dict] = None
    output_schema: Optional[Dict] = None
    cost_estimate: Optional[float] = None
    tags: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "description": self.description,
            "inputSchema": self.input_schema,
            "outputSchema": self.output_schema,
            "costEstimate": self.cost_estimate,
            "tags": self.tags,
        }


@dataclass
class TaskContext:
    """Context passed to task handlers."""
    workflow_id: str
    node_id: str
    capability: str
    trace_id: Optional[str] = None
    parent_span_id: Optional[str] = None
    budget_cents: Optional[int] = None
    payer_did: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


TaskHandler = Callable[[Dict[str, Any], TaskContext], Union[Dict[str, Any], Any]]


class NooterraAgent:
    """
    Nooterra Agent Server.
    
    Usage:
        agent = NooterraAgent(
            did="did:noot:my-agent",
            secret_key=os.environ["AGENT_SECRET"],
        )
        
        @agent.capability("text.summarize")
        def summarize(input_data, ctx):
            return {"summary": "..."}
        
        agent.run(port=8080)
    """

    def __init__(
        self,
        did: str,
        secret_key: str,
        name: Optional[str] = None,
        version: str = "1.0.0",
        endpoint: Optional[str] = None,
        registry_url: Optional[str] = None,
        coordinator_url: Optional[str] = None,
    ):
        self.did = did
        self.secret_key = secret_key
        self.name = name or did.split(":")[-1]
        self.version = version
        self.endpoint = endpoint
        self.registry_url = registry_url or os.environ.get("REGISTRY_URL", "")
        self.coordinator_url = coordinator_url or os.environ.get("COORDINATOR_URL", "")
        
        self._capabilities: Dict[str, Capability] = {}
        self._handlers: Dict[str, TaskHandler] = {}

    def capability(
        self,
        capability_id: str,
        description: Optional[str] = None,
        input_schema: Optional[Dict] = None,
        output_schema: Optional[Dict] = None,
        cost_estimate: Optional[float] = None,
        tags: Optional[List[str]] = None,
    ):
        """Decorator to register a capability handler."""
        def decorator(func: TaskHandler) -> TaskHandler:
            cap = Capability(
                id=capability_id,
                description=description or func.__doc__ or f"Handler for {capability_id}",
                input_schema=input_schema,
                output_schema=output_schema,
                cost_estimate=cost_estimate,
                tags=tags or [],
            )
            self._capabilities[capability_id] = cap
            self._handlers[capability_id] = func
            return func
        return decorator

    def add_capability(
        self,
        capability_id: str,
        handler: TaskHandler,
        description: str,
        **kwargs,
    ):
        """Programmatically add a capability."""
        cap = Capability(id=capability_id, description=description, **kwargs)
        self._capabilities[capability_id] = cap
        self._handlers[capability_id] = handler

    def get_acard(self) -> Dict[str, Any]:
        """Get the Agent Card (ACARD) for registration."""
        return {
            "did": self.did,
            "name": self.name,
            "version": self.version,
            "endpoint": self.endpoint,
            "capabilities": [cap.to_dict() for cap in self._capabilities.values()],
        }

    def verify_signature(self, body: bytes, signature: str) -> bool:
        """Verify HMAC-SHA256 signature from coordinator."""
        expected = hmac.new(
            self.secret_key.encode(),
            body,
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(expected, signature)

    def handle_task(self, body: Dict[str, Any]) -> Dict[str, Any]:
        """Process a task request."""
        capability = body.get("capability", "")
        input_data = body.get("input", {})
        
        handler = self._handlers.get(capability)
        if not handler:
            return {
                "status": "error",
                "error": f"Unknown capability: {capability}",
            }
        
        ctx = TaskContext(
            workflow_id=body.get("workflowId", ""),
            node_id=body.get("nodeId", ""),
            capability=capability,
            trace_id=body.get("traceId"),
            parent_span_id=body.get("parentSpanId"),
            budget_cents=body.get("budgetCents"),
            payer_did=body.get("payerDid"),
            metadata=body.get("metadata", {}),
        )
        
        try:
            result = handler(input_data, ctx)
            if isinstance(result, dict):
                return {"status": "ok", "output": result}
            return {"status": "ok", "output": {"result": result}}
        except Exception as e:
            return {"status": "error", "error": str(e)}

    def create_flask_app(self) -> "Flask":
        """Create a Flask app for the agent."""
        if not HAS_FLASK:
            raise ImportError("Flask is required. Install with: pip install flask")
        
        app = Flask(__name__)

        @app.route("/health", methods=["GET"])
        def health():
            return jsonify({"status": "ok", "agent": self.did})

        @app.route("/acard", methods=["GET"])
        def acard():
            return jsonify(self.get_acard())

        @app.route("/invoke", methods=["POST"])
        def invoke():
            # Verify signature
            signature = request.headers.get("X-Nooterra-Signature", "")
            if not self.verify_signature(request.data, signature):
                return jsonify({"status": "error", "error": "Invalid signature"}), 401
            
            body = request.get_json()
            result = self.handle_task(body)
            status_code = 200 if result.get("status") == "ok" else 400
            return jsonify(result), status_code

        return app

    def create_fastapi_app(self) -> "FastAPI":
        """Create a FastAPI app for the agent."""
        if not HAS_FASTAPI:
            raise ImportError("FastAPI is required. Install with: pip install fastapi uvicorn")
        
        app = FastAPI(title=self.name, version=self.version)

        @app.get("/health")
        async def health():
            return {"status": "ok", "agent": self.did}

        @app.get("/acard")
        async def acard():
            return self.get_acard()

        @app.post("/invoke")
        async def invoke(request: Request):
            body_bytes = await request.body()
            signature = request.headers.get("X-Nooterra-Signature", "")
            
            if not self.verify_signature(body_bytes, signature):
                raise HTTPException(status_code=401, detail="Invalid signature")
            
            body = json.loads(body_bytes)
            result = self.handle_task(body)
            
            if result.get("status") != "ok":
                return JSONResponse(result, status_code=400)
            return result

        return app

    def run(
        self,
        port: int = 8080,
        host: str = "0.0.0.0",
        framework: str = "auto",
        **kwargs,
    ):
        """Run the agent server.
        
        Args:
            port: Port to listen on
            host: Host to bind to
            framework: 'flask', 'fastapi', or 'auto' (detect available)
        """
        if framework == "auto":
            framework = "fastapi" if HAS_FASTAPI else "flask" if HAS_FLASK else None
        
        if framework == "fastapi":
            app = self.create_fastapi_app()
            uvicorn.run(app, host=host, port=port, **kwargs)
        elif framework == "flask":
            app = self.create_flask_app()
            app.run(host=host, port=port, **kwargs)
        else:
            raise ImportError(
                "No web framework available. Install flask or fastapi:\n"
                "  pip install flask\n"
                "  pip install fastapi uvicorn"
            )

    def register(self, registry_url: Optional[str] = None) -> Dict[str, Any]:
        """Register the agent with the registry."""
        import requests
        
        url = registry_url or self.registry_url
        if not url:
            raise ValueError("registry_url is required")
        
        resp = requests.post(
            f"{url.rstrip('/')}/v1/agent/register",
            json=self.get_acard(),
            headers={"Content-Type": "application/json"},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()


# Convenience function for simple agents
def create_agent(
    did: str,
    secret_key: str,
    **kwargs,
) -> NooterraAgent:
    """Create a new Nooterra agent."""
    return NooterraAgent(did=did, secret_key=secret_key, **kwargs)
