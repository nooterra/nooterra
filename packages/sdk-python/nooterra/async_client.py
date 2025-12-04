"""
Async Nooterra Client using aiohttp
"""

import os
import uuid
from typing import Any, Dict, List, Optional

try:
    import aiohttp
except ImportError:
    aiohttp = None  # type: ignore


class AsyncNooterraError(Exception):
    """Async client error."""
    pass


class AsyncNooterraClient:
    """
    Async client for Nooterra APIs using aiohttp.
    
    Usage:
        async with AsyncNooterraClient(
            registry_url="https://registry.nooterra.ai",
            coordinator_url="https://coord.nooterra.ai",
        ) as client:
            agents = await client.discovery("summarize text")
            workflow = await client.create_workflow(...)
    """

    def __init__(
        self,
        registry_url: Optional[str] = None,
        coordinator_url: Optional[str] = None,
        registry_api_key: Optional[str] = None,
        coordinator_api_key: Optional[str] = None,
        timeout: int = 30,
    ):
        if aiohttp is None:
            raise ImportError("aiohttp is required for async client. Install with: pip install aiohttp")
        
        self.registry_url = (registry_url or os.environ.get("REGISTRY_URL", "")).rstrip("/")
        self.coordinator_url = (coordinator_url or os.environ.get("COORDINATOR_URL", "")).rstrip("/")
        self.registry_api_key = registry_api_key or os.environ.get("REGISTRY_API_KEY", "")
        self.coordinator_api_key = coordinator_api_key or os.environ.get("COORDINATOR_API_KEY", "")
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self._session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self):
        self._session = aiohttp.ClientSession(timeout=self.timeout)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._session:
            await self._session.close()

    def _headers(self, api_key: Optional[str]) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["x-api-key"] = api_key
        return headers

    async def _get(self, url: str, api_key: str, params: Optional[Dict] = None) -> Any:
        if not self._session:
            raise AsyncNooterraError("Client not initialized. Use 'async with' context manager.")
        async with self._session.get(url, headers=self._headers(api_key), params=params) as resp:
            if not resp.ok:
                text = await resp.text()
                raise AsyncNooterraError(f"GET {url} failed: {resp.status} {text}")
            return await resp.json()

    async def _post(self, url: str, api_key: str, body: Optional[Dict] = None) -> Any:
        if not self._session:
            raise AsyncNooterraError("Client not initialized. Use 'async with' context manager.")
        async with self._session.post(url, headers=self._headers(api_key), json=body or {}) as resp:
            if not resp.ok:
                text = await resp.text()
                raise AsyncNooterraError(f"POST {url} failed: {resp.status} {text}")
            return await resp.json()

    async def _delete(self, url: str, api_key: str) -> Any:
        if not self._session:
            raise AsyncNooterraError("Client not initialized. Use 'async with' context manager.")
        async with self._session.delete(url, headers=self._headers(api_key)) as resp:
            if not resp.ok:
                text = await resp.text()
                raise AsyncNooterraError(f"DELETE {url} failed: {resp.status} {text}")
            return await resp.json()

    # ============================================================
    # REGISTRY APIs
    # ============================================================

    async def register_agent(
        self,
        did: str,
        capabilities: List[Dict[str, Any]],
        name: Optional[str] = None,
        endpoint: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Register an agent with the registry."""
        body = {"did": did, "capabilities": capabilities}
        if name:
            body["name"] = name
        if endpoint:
            body["endpoint"] = endpoint
        return await self._post(
            f"{self.registry_url}/v1/agent/register",
            self.registry_api_key,
            body,
        )

    async def discovery(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Discover agents matching a query."""
        result = await self._post(
            f"{self.registry_url}/v1/agent/discovery",
            self.registry_api_key,
            {"query": query, "limit": limit},
        )
        return result.get("agents", [])

    async def get_agent(self, did: str) -> Optional[Dict[str, Any]]:
        """Get agent details by DID."""
        try:
            return await self._get(
                f"{self.registry_url}/v1/agent/{did}",
                self.registry_api_key,
            )
        except AsyncNooterraError as e:
            if "404" in str(e):
                return None
            raise

    # ============================================================
    # COORDINATOR APIs - Workflows
    # ============================================================

    async def create_workflow(
        self,
        capability: str,
        input_data: Dict[str, Any],
        max_cents: Optional[int] = None,
        target_agent_id: Optional[str] = None,
        webhook_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create and start a workflow."""
        body = {
            "nodes": [{
                "id": "main",
                "capability": capability,
                "input": input_data,
            }],
            "edges": [],
        }
        if max_cents is not None:
            body["maxCents"] = max_cents
        if target_agent_id:
            body["nodes"][0]["targetAgentId"] = target_agent_id
        if webhook_url:
            body["webhookUrl"] = webhook_url
        
        return await self._post(
            f"{self.coordinator_url}/v1/workflows",
            self.coordinator_api_key,
            body,
        )

    async def create_dag_workflow(
        self,
        nodes: List[Dict[str, Any]],
        edges: List[Dict[str, Any]],
        max_cents: Optional[int] = None,
        webhook_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a DAG workflow with multiple nodes."""
        body = {"nodes": nodes, "edges": edges}
        if max_cents is not None:
            body["maxCents"] = max_cents
        if webhook_url:
            body["webhookUrl"] = webhook_url
        
        return await self._post(
            f"{self.coordinator_url}/v1/workflows",
            self.coordinator_api_key,
            body,
        )

    async def get_workflow(self, workflow_id: str) -> Dict[str, Any]:
        """Get workflow status and results."""
        return await self._get(
            f"{self.coordinator_url}/v1/workflows/{workflow_id}",
            self.coordinator_api_key,
        )

    async def list_workflows(
        self,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """List workflows."""
        params = {"limit": limit, "offset": offset}
        if status:
            params["status"] = status
        result = await self._get(
            f"{self.coordinator_url}/v1/workflows",
            self.coordinator_api_key,
            params,
        )
        return result.get("workflows", [])

    async def cancel_workflow(
        self,
        workflow_id: str,
        reason: str = "user_request",
        details: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Cancel a running workflow."""
        body = {"reason": reason}
        if details:
            body["details"] = details
        return await self._post(
            f"{self.coordinator_url}/v1/workflows/{workflow_id}/cancel",
            self.coordinator_api_key,
            body,
        )

    # ============================================================
    # COORDINATOR APIs - Agents & Balances
    # ============================================================

    async def get_balance(self, agent_did: str) -> Dict[str, Any]:
        """Get agent balance."""
        return await self._get(
            f"{self.coordinator_url}/v1/balances/{agent_did}",
            self.coordinator_api_key,
        )

    async def get_ledger(self, agent_did: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Get agent ledger history."""
        result = await self._get(
            f"{self.coordinator_url}/v1/ledger/{agent_did}/history",
            self.coordinator_api_key,
            {"limit": limit},
        )
        return result.get("events", [])

    async def submit_feedback(
        self,
        workflow_id: str,
        agent_did: str,
        rating: float,
        comment: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Submit feedback for an agent's work."""
        body = {"agentDid": agent_did, "rating": rating}
        if comment:
            body["comment"] = comment
        return await self._post(
            f"{self.coordinator_url}/v1/workflows/{workflow_id}/feedback",
            self.coordinator_api_key,
            body,
        )

    # ============================================================
    # PROTOCOL APIs
    # ============================================================

    async def check_revoked(self, did: str) -> Dict[str, Any]:
        """Check if a DID is revoked."""
        return await self._get(
            f"{self.coordinator_url}/v1/revoked/{did}",
            self.coordinator_api_key,
        )

    async def get_audit_log(
        self,
        limit: int = 50,
        event_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Query the audit chain."""
        params = {"limit": limit}
        if event_type:
            params["eventType"] = event_type
        result = await self._get(
            f"{self.coordinator_url}/v1/audit",
            self.coordinator_api_key,
            params,
        )
        return result.get("entries", [])

    async def create_schedule(
        self,
        name: str,
        cron_expression: str,
        workflow_template: Dict[str, Any],
        timezone: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a scheduled workflow."""
        body = {
            "name": name,
            "cronExpression": cron_expression,
            "workflowTemplate": workflow_template,
        }
        if timezone:
            body["timezone"] = timezone
        return await self._post(
            f"{self.coordinator_url}/v1/schedules",
            self.coordinator_api_key,
            body,
        )

    async def list_schedules(self) -> List[Dict[str, Any]]:
        """List scheduled workflows."""
        result = await self._get(
            f"{self.coordinator_url}/v1/schedules",
            self.coordinator_api_key,
        )
        return result.get("schedules", [])

    async def check_quota(
        self,
        owner_did: str,
        estimated_spend_cents: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Check if quota allows an operation."""
        body = {}
        if estimated_spend_cents:
            body["estimatedSpendCents"] = estimated_spend_cents
        return await self._post(
            f"{self.coordinator_url}/v1/quotas/{owner_did}/check",
            self.coordinator_api_key,
            body,
        )

    async def open_dispute(
        self,
        dispute_type: str,
        description: str,
        workflow_id: Optional[str] = None,
        evidence: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """Open a dispute."""
        body = {"disputeType": dispute_type, "description": description}
        if workflow_id:
            body["workflowId"] = workflow_id
        if evidence:
            body["evidence"] = evidence
        return await self._post(
            f"{self.coordinator_url}/v1/disputes",
            self.coordinator_api_key,
            body,
        )

    async def list_peers(self, region: Optional[str] = None) -> List[Dict[str, Any]]:
        """List coordinator peers."""
        params = {}
        if region:
            params["region"] = region
        result = await self._get(
            f"{self.coordinator_url}/v1/federation/peers",
            self.coordinator_api_key,
            params,
        )
        return result.get("peers", [])

    # ============================================================
    # UTILITIES
    # ============================================================

    @staticmethod
    def random_did(prefix: str = "agent") -> str:
        """Generate a random DID."""
        return f"did:noot:{prefix}-{uuid.uuid4()}"
