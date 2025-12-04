"""
Nooterra Protocol API - Trust, Accountability, Identity, Economics, Federation
"""

from typing import Any, Dict, List, Optional
from datetime import datetime
import requests


class ProtocolClient:
    """Client for Nooterra Protocol APIs."""
    
    def __init__(
        self,
        coordinator_url: str,
        api_key: Optional[str] = None,
        agent_did: Optional[str] = None,
        timeout: int = 30,
    ):
        self.coordinator_url = coordinator_url.rstrip("/")
        self.api_key = api_key
        self.agent_did = agent_did
        self.timeout = timeout
    
    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["x-api-key"] = self.api_key
        return headers
    
    def _get(self, path: str, params: Optional[Dict] = None) -> Any:
        resp = requests.get(
            f"{self.coordinator_url}{path}",
            params=params,
            headers=self._headers(),
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()
    
    def _post(self, path: str, body: Optional[Dict] = None) -> Any:
        resp = requests.post(
            f"{self.coordinator_url}{path}",
            json=body or {},
            headers=self._headers(),
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()
    
    def _delete(self, path: str) -> Any:
        resp = requests.delete(
            f"{self.coordinator_url}{path}",
            headers=self._headers(),
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    # ============================================================
    # TRUST LAYER
    # ============================================================
    
    def check_revoked(self, did: str) -> Dict[str, Any]:
        """Check if a DID is revoked."""
        return self._get(f"/v1/revoked/{did}")
    
    def revoke_did(
        self,
        did: str,
        reason: str,
        evidence: Optional[Dict] = None,
        expires_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Revoke a DID."""
        body = {"did": did, "reason": reason}
        if evidence:
            body["evidence"] = evidence
        if expires_at:
            body["expiresAt"] = expires_at
        return self._post("/v1/trust/revoke", body)
    
    def rotate_key(
        self,
        agent_did: str,
        new_public_key: str,
        rotation_proof: str,
    ) -> Dict[str, Any]:
        """Rotate an agent's cryptographic key."""
        return self._post("/v1/trust/rotate-key", {
            "agentDid": agent_did,
            "newPublicKey": new_public_key,
            "rotationProof": rotation_proof,
        })
    
    def get_key_history(self, did: str) -> List[Dict[str, Any]]:
        """Get key rotation history for a DID."""
        result = self._get(f"/v1/trust/key-history/{did}")
        return result.get("keyHistory", [])
    
    def get_signed_results(self, workflow_id: str) -> List[Dict[str, Any]]:
        """Get cryptographically signed results for a workflow."""
        result = self._get(f"/v1/trust/signed-results/{workflow_id}")
        return result.get("results", [])

    # ============================================================
    # ACCOUNTABILITY
    # ============================================================
    
    def get_audit_log(
        self,
        limit: int = 50,
        offset: int = 0,
        event_type: Optional[str] = None,
        actor_did: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Query the immutable audit chain."""
        params = {"limit": limit, "offset": offset}
        if event_type:
            params["eventType"] = event_type
        if actor_did:
            params["actorDid"] = actor_did
        result = self._get("/v1/audit", params)
        return result.get("entries", [])
    
    def submit_receipt(
        self,
        workflow_id: str,
        node_id: str,
        input_hash: str,
        output_hash: str,
        started_at: str,
        completed_at: str,
        compute_ms: int,
        signature: str,
    ) -> Dict[str, Any]:
        """Submit a cryptographic receipt for work performed."""
        return self._post("/v1/receipts", {
            "workflowId": workflow_id,
            "nodeId": node_id,
            "inputHash": input_hash,
            "outputHash": output_hash,
            "startedAt": started_at,
            "completedAt": completed_at,
            "computeMs": compute_ms,
            "signature": signature,
        })
    
    def get_receipts(self, agent_did: str) -> List[Dict[str, Any]]:
        """Get all receipts for an agent."""
        result = self._get(f"/v1/receipts/{agent_did}")
        return result.get("receipts", [])
    
    def get_trace(self, trace_id: str) -> Dict[str, Any]:
        """Get distributed trace for a workflow."""
        return self._get(f"/v1/traces/{trace_id}")

    # ============================================================
    # PROTOCOL OPERATIONS
    # ============================================================
    
    def cancel_workflow(
        self,
        workflow_id: str,
        reason: str,
        details: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Cancel a running workflow.
        
        Args:
            reason: One of 'user_request', 'budget_exceeded', 'timeout', 'error', 'policy_violation'
        """
        body = {"reason": reason}
        if details:
            body["details"] = details
        return self._post(f"/v1/workflows/{workflow_id}/cancel", body)
    
    def register_capability_version(
        self,
        capability_id: str,
        version: str,
        input_schema: Optional[Dict] = None,
        output_schema: Optional[Dict] = None,
        changelog: Optional[str] = None,
        deprecates_version: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Register a new version of a capability."""
        body = {"capabilityId": capability_id, "version": version}
        if input_schema:
            body["inputSchema"] = input_schema
        if output_schema:
            body["outputSchema"] = output_schema
        if changelog:
            body["changelog"] = changelog
        if deprecates_version:
            body["deprecatesVersion"] = deprecates_version
        return self._post("/v1/capabilities/versions", body)
    
    def get_capability_versions(self, capability_id: str) -> List[Dict[str, Any]]:
        """Get all versions of a capability."""
        result = self._get(f"/v1/capabilities/{capability_id}/versions")
        return result.get("versions", [])
    
    def create_schedule(
        self,
        name: str,
        cron_expression: str,
        workflow_template: Dict[str, Any],
        timezone: Optional[str] = None,
        max_runs: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Create a scheduled workflow."""
        body = {
            "name": name,
            "cronExpression": cron_expression,
            "workflowTemplate": workflow_template,
        }
        if timezone:
            body["timezone"] = timezone
        if max_runs:
            body["maxRuns"] = max_runs
        return self._post("/v1/schedules", body)
    
    def list_schedules(self) -> List[Dict[str, Any]]:
        """List all scheduled workflows."""
        result = self._get("/v1/schedules")
        return result.get("schedules", [])
    
    def delete_schedule(self, schedule_id: str) -> Dict[str, Any]:
        """Delete a scheduled workflow."""
        return self._delete(f"/v1/schedules/{schedule_id}")

    # ============================================================
    # IDENTITY
    # ============================================================
    
    def set_inheritance(
        self,
        agent_did: str,
        inherits_to_did: str,
        dead_man_switch_days: Optional[int] = None,
        conditions: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """Set up agent inheritance (dead man's switch)."""
        body = {"agentDid": agent_did, "inheritsToDid": inherits_to_did}
        if dead_man_switch_days:
            body["deadManSwitchDays"] = dead_man_switch_days
        if conditions:
            body["conditions"] = conditions
        return self._post("/v1/identity/inheritance", body)
    
    def get_inheritance(self, agent_did: str) -> Dict[str, Any]:
        """Get inheritance settings for an agent."""
        return self._get(f"/v1/identity/inheritance/{agent_did}")
    
    def register_name(self, name: str, agent_did: str) -> Dict[str, Any]:
        """Register a human-readable name for an agent."""
        return self._post("/v1/identity/names", {"name": name, "agentDid": agent_did})
    
    def resolve_name(self, name: str) -> Optional[Dict[str, Any]]:
        """Resolve a name to an agent DID."""
        try:
            return self._get(f"/v1/identity/names/{name}")
        except requests.HTTPError as e:
            if e.response.status_code == 404:
                return None
            raise
    
    def request_recovery(
        self,
        agent_did: str,
        recovery_type: str,
        recovery_address: str,
        proof: str,
        new_public_key: str,
    ) -> Dict[str, Any]:
        """Request agent recovery.
        
        Args:
            recovery_type: One of 'social_recovery', 'custodian_recovery', 'time_lock_recovery'
        """
        return self._post("/v1/identity/recover", {
            "agentDid": agent_did,
            "recoveryType": recovery_type,
            "recoveryAddress": recovery_address,
            "proof": proof,
            "newPublicKey": new_public_key,
        })

    # ============================================================
    # ECONOMICS
    # ============================================================
    
    def generate_invoice(
        self,
        payer_did: str,
        workflow_id: Optional[str] = None,
        period_start: Optional[str] = None,
        period_end: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Generate an invoice."""
        body = {"payerDid": payer_did}
        if workflow_id:
            body["workflowId"] = workflow_id
        if period_start:
            body["periodStart"] = period_start
        if period_end:
            body["periodEnd"] = period_end
        return self._post("/v1/invoices", body)
    
    def get_invoice(self, invoice_id: str) -> Dict[str, Any]:
        """Get invoice details."""
        return self._get(f"/v1/invoices/{invoice_id}")
    
    def list_invoices(
        self,
        payer_did: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """List invoices."""
        params = {"limit": limit}
        if payer_did:
            params["payerDid"] = payer_did
        if status:
            params["status"] = status
        result = self._get("/v1/invoices", params)
        return result.get("invoices", [])
    
    def open_dispute(
        self,
        dispute_type: str,
        description: str,
        workflow_id: Optional[str] = None,
        node_id: Optional[str] = None,
        respondent_did: Optional[str] = None,
        evidence: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """Open a dispute.
        
        Args:
            dispute_type: One of 'quality', 'timeout', 'incorrect_output', 'overcharge', 'fraud', 'other'
        """
        body = {"disputeType": dispute_type, "description": description}
        if workflow_id:
            body["workflowId"] = workflow_id
        if node_id:
            body["nodeId"] = node_id
        if respondent_did:
            body["respondentDid"] = respondent_did
        if evidence:
            body["evidence"] = evidence
        return self._post("/v1/disputes", body)
    
    def get_dispute(self, dispute_id: str) -> Dict[str, Any]:
        """Get dispute details."""
        return self._get(f"/v1/disputes/{dispute_id}")
    
    def list_disputes(
        self,
        status: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """List disputes."""
        params = {"limit": limit}
        if status:
            params["status"] = status
        result = self._get("/v1/disputes", params)
        return result.get("disputes", [])
    
    def check_quota(
        self,
        owner_did: str,
        estimated_spend_cents: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Check if quota allows an operation."""
        body = {}
        if estimated_spend_cents:
            body["estimatedSpendCents"] = estimated_spend_cents
        return self._post(f"/v1/quotas/{owner_did}/check", body)
    
    def get_quota(self, owner_did: str) -> Dict[str, Any]:
        """Get quota settings for an owner."""
        return self._get(f"/v1/quotas/{owner_did}")
    
    def update_quota(
        self,
        owner_did: str,
        max_workflows_per_day: Optional[int] = None,
        max_concurrent_workflows: Optional[int] = None,
        max_spend_per_day_cents: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Update quota limits."""
        body = {}
        if max_workflows_per_day is not None:
            body["maxWorkflowsPerDay"] = max_workflows_per_day
        if max_concurrent_workflows is not None:
            body["maxConcurrentWorkflows"] = max_concurrent_workflows
        if max_spend_per_day_cents is not None:
            body["maxSpendPerDayCents"] = max_spend_per_day_cents
        return self._post(f"/v1/quotas/{owner_did}", body)

    # ============================================================
    # FEDERATION
    # ============================================================
    
    def list_peers(self, region: Optional[str] = None) -> List[Dict[str, Any]]:
        """List coordinator peers."""
        params = {}
        if region:
            params["region"] = region
        result = self._get("/v1/federation/peers", params)
        return result.get("peers", [])
    
    def find_best_peer(
        self,
        capability: str,
        request_region: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Find the best peer for a capability."""
        params = {}
        if request_region:
            params["requestRegion"] = request_region
        try:
            return self._get(f"/v1/federation/route/{capability}", params)
        except requests.HTTPError as e:
            if e.response.status_code == 404:
                return None
            raise
    
    def list_subnets(self, member_did: Optional[str] = None) -> List[Dict[str, Any]]:
        """List private subnets."""
        params = {}
        if member_did:
            params["memberDid"] = member_did
        result = self._get("/v1/federation/subnets", params)
        return result.get("subnets", [])
    
    def create_subnet(
        self,
        name: str,
        member_dids: List[str],
        description: Optional[str] = None,
        policy_type: str = "private",
    ) -> Dict[str, Any]:
        """Create a private subnet."""
        body = {
            "name": name,
            "memberDids": member_dids,
            "policyType": policy_type,
        }
        if description:
            body["description"] = description
        return self._post("/v1/federation/subnets", body)
    
    def join_subnet(self, subnet_id: str, member_did: str) -> Dict[str, Any]:
        """Add a member to a subnet."""
        return self._post(f"/v1/federation/subnets/{subnet_id}/members", {
            "memberDid": member_did,
        })
