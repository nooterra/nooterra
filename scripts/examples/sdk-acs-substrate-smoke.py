#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import pathlib
import random
import sys
import time
import hashlib
from datetime import datetime, timedelta, timezone

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "packages" / "api-sdk-python"))

from nooterra_api_sdk import NooterraApiError, NooterraClient  # noqa: E402


def _unique_suffix() -> str:
    return f"{int(time.time() * 1000):x}_{random.randint(0, 0xFFFFFF):06x}"


def _fixture_keys() -> tuple[str, str]:
    fixture_path = REPO_ROOT / "test" / "fixtures" / "keys" / "fixture_keypairs.json"
    with fixture_path.open("r", encoding="utf-8") as fp:
        raw = json.load(fp)
    principal = str(raw["serverA"]["publicKeyPem"])
    worker = str(raw["serverB"]["publicKeyPem"])
    return principal, worker


def _require_body(result: dict, label: str) -> dict:
    if not isinstance(result, dict):
        raise RuntimeError(f"{label}: response is not an object")
    body = result.get("body")
    if not isinstance(body, dict):
        raise RuntimeError(f"{label}: response body is missing")
    if body.get("ok") is False:
        raise RuntimeError(f"{label}: body.ok is false")
    return body


def _require_object(value: object, label: str) -> dict:
    if not isinstance(value, dict):
        raise RuntimeError(f"{label}: expected object")
    return value


def _require_string(value: object, label: str) -> str:
    if not isinstance(value, str) or value.strip() == "":
        raise RuntimeError(f"{label}: expected non-empty string")
    return value.strip()


def _future_iso(hours: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()


def main() -> int:
    base_url = os.environ.get("NOOTERRA_BASE_URL", "http://127.0.0.1:3000")
    tenant_id = os.environ.get("NOOTERRA_TENANT_ID", "tenant_default")
    api_key = os.environ.get("NOOTERRA_API_KEY")
    if not api_key:
        print("NOOTERRA_API_KEY is not set; calls will fail unless API auth is disabled.", file=sys.stderr)

    principal_public_key_pem, worker_public_key_pem = _fixture_keys()
    suffix = _unique_suffix()
    capability_id = "travel.booking"
    principal_agent_id = f"agt_py_acs_principal_{suffix}"
    worker_agent_id = f"agt_py_acs_worker_{suffix}"

    client = NooterraClient(base_url=base_url, tenant_id=tenant_id, api_key=api_key)

    try:
        _require_body(
            client.register_agent(
                {
                    "agentId": principal_agent_id,
                    "displayName": "Python ACS Principal",
                    "owner": {"ownerType": "service", "ownerId": "svc_py_acs"},
                    "capabilities": [capability_id, "travel.policy"],
                    "publicKeyPem": principal_public_key_pem,
                }
            ),
            "register principal",
        )
        _require_body(
            client.register_agent(
                {
                    "agentId": worker_agent_id,
                    "displayName": "Python ACS Worker",
                    "owner": {"ownerType": "service", "ownerId": "svc_py_acs"},
                    "capabilities": [capability_id, "travel.pricing"],
                    "publicKeyPem": worker_public_key_pem,
                }
            ),
            "register worker",
        )

        _require_body(
            client.upsert_agent_card(
                {
                    "agentId": principal_agent_id,
                    "displayName": "Python ACS Principal",
                    "description": "principal coordinator",
                    "capabilities": [capability_id],
                    "visibility": "public",
                    "host": {"runtime": "openclaw", "endpoint": "https://example.invalid/principal"},
                    "priceHint": {"amountCents": 250, "currency": "USD"},
                }
            ),
            "upsert principal card",
        )
        _require_body(
            client.upsert_agent_card(
                {
                    "agentId": worker_agent_id,
                    "displayName": "Python ACS Worker",
                    "description": "specialized travel worker",
                    "capabilities": [capability_id],
                    "visibility": "public",
                    "host": {"runtime": "nooterra", "endpoint": "https://example.invalid/worker"},
                    "priceHint": {"amountCents": 180, "currency": "USD"},
                }
            ),
            "upsert worker card",
        )

        tenant_discovery = _require_body(
            client.discover_agent_cards(
                {
                    "capability": capability_id,
                    "includeReputation": True,
                    "includeRoutingFactors": True,
                    "requesterAgentId": principal_agent_id,
                    "limit": 5,
                }
            ),
            "tenant discovery",
        )
        public_discovery = _require_body(
            client.discover_public_agent_cards(
                {
                    "capability": capability_id,
                    "includeReputation": False,
                    "limit": 5,
                }
            ),
            "public discovery",
        )

        delegation_grant = _require_object(
            _require_body(
                client.issue_delegation_grant(
                    {
                        "delegatorAgentId": principal_agent_id,
                        "delegateeAgentId": worker_agent_id,
                        "scope": {
                            "allowedRiskClasses": ["financial"],
                            "sideEffectingAllowed": True,
                        },
                        "spendLimit": {
                            "currency": "USD",
                            "maxPerCallCents": 5_000,
                            "maxTotalCents": 20_000,
                        },
                        "chainBinding": {"depth": 0, "maxDelegationDepth": 0},
                        "validity": {"expiresAt": _future_iso(48)},
                    }
                ),
                "issue delegation grant",
            ).get("delegationGrant"),
            "delegationGrant",
        )
        delegation_grant_id = _require_string(delegation_grant.get("grantId"), "delegationGrant.grantId")
        _require_body(client.get_delegation_grant(delegation_grant_id), "get delegation grant")
        _require_body(client.list_delegation_grants({"grantId": delegation_grant_id}), "list delegation grants")

        authority_grant = _require_object(
            _require_body(
                client.issue_authority_grant(
                    {
                        "principalRef": {"principalType": "service", "principalId": "svc_py_acs"},
                        "granteeAgentId": principal_agent_id,
                        "scope": {
                            "allowedRiskClasses": ["financial"],
                            "sideEffectingAllowed": True,
                        },
                        "spendEnvelope": {
                            "currency": "USD",
                            "maxPerCallCents": 5_000,
                            "maxTotalCents": 20_000,
                        },
                        "chainBinding": {"depth": 0, "maxDelegationDepth": 0},
                        "validity": {"expiresAt": _future_iso(48)},
                    }
                ),
                "issue authority grant",
            ).get("authorityGrant"),
            "authorityGrant",
        )
        authority_grant_id = _require_string(authority_grant.get("grantId"), "authorityGrant.grantId")
        _require_body(client.get_authority_grant(authority_grant_id), "get authority grant")
        _require_body(client.list_authority_grants({"grantId": authority_grant_id}), "list authority grants")

        checkpoint_delegation_grant = _require_object(
            _require_body(
                client.issue_delegation_grant(
                    {
                        "delegatorAgentId": worker_agent_id,
                        "delegateeAgentId": principal_agent_id,
                        "scope": {
                            "allowedRiskClasses": ["financial"],
                            "sideEffectingAllowed": True,
                        },
                        "spendLimit": {
                            "currency": "USD",
                            "maxPerCallCents": 1_000,
                            "maxTotalCents": 10_000,
                        },
                        "chainBinding": {"depth": 0, "maxDelegationDepth": 0},
                        "validity": {"expiresAt": _future_iso(48)},
                    }
                ),
                "issue checkpoint delegation grant",
            ).get("delegationGrant"),
            "checkpointDelegationGrant",
        )
        checkpoint_delegation_grant_id = _require_string(
            checkpoint_delegation_grant.get("grantId"), "checkpointDelegationGrant.grantId"
        )

        task_quote = _require_object(
            _require_body(
                client.create_task_quote(
                    {
                        "buyerAgentId": principal_agent_id,
                        "sellerAgentId": worker_agent_id,
                        "requiredCapability": capability_id,
                        "pricing": {"amountCents": 1_500, "currency": "USD"},
                    }
                ),
                "create task quote",
            ).get("taskQuote"),
            "taskQuote",
        )
        quote_id = _require_string(task_quote.get("quoteId"), "taskQuote.quoteId")
        _require_body(client.get_task_quote(quote_id), "get task quote")

        task_offer = _require_object(
            _require_body(
                client.create_task_offer(
                    {
                        "buyerAgentId": principal_agent_id,
                        "sellerAgentId": worker_agent_id,
                        "quoteRef": {"quoteId": quote_id, "quoteHash": task_quote.get("quoteHash")},
                        "pricing": {"amountCents": 1_500, "currency": "USD"},
                    }
                ),
                "create task offer",
            ).get("taskOffer"),
            "taskOffer",
        )
        offer_id = _require_string(task_offer.get("offerId"), "taskOffer.offerId")
        _require_body(client.get_task_offer(offer_id), "get task offer")

        task_acceptance = _require_object(
            _require_body(
                client.create_task_acceptance(
                    {
                        "quoteId": quote_id,
                        "offerId": offer_id,
                        "acceptedByAgentId": worker_agent_id,
                    }
                ),
                "create task acceptance",
            ).get("taskAcceptance"),
            "taskAcceptance",
        )
        acceptance_id = _require_string(task_acceptance.get("acceptanceId"), "taskAcceptance.acceptanceId")
        acceptance_hash = _require_string(task_acceptance.get("acceptanceHash"), "taskAcceptance.acceptanceHash")
        _require_body(client.get_task_acceptance(acceptance_id), "get task acceptance")

        work_order = _require_object(
            _require_body(
                client.create_work_order(
                    {
                        "principalAgentId": principal_agent_id,
                        "subAgentId": worker_agent_id,
                        "requiredCapability": capability_id,
                        "pricing": {"amountCents": 1_500, "currency": "USD"},
                        "metering": {
                            "mode": "metered",
                            "requireFinalMeterEvidence": True,
                            "enforceFinalReconcile": True,
                            "maxTopUpCents": 1_000,
                            "unit": "usd_cents",
                        },
                        "acceptanceRef": {"acceptanceId": acceptance_id, "acceptanceHash": acceptance_hash},
                        "delegationGrantRef": delegation_grant_id,
                        "authorityGrantRef": authority_grant_id,
                        "specification": {"task": "book flight + hotel options"},
                    }
                ),
                "create work order",
            ).get("workOrder"),
            "workOrder",
        )
        work_order_id = _require_string(work_order.get("workOrderId"), "workOrder.workOrderId")
        _require_body(client.get_work_order(work_order_id), "get work order")
        _require_body(client.accept_work_order(work_order_id, {"acceptedByAgentId": worker_agent_id}), "accept work order")
        _require_body(
            client.progress_work_order(
                work_order_id,
                {"eventType": "progress", "message": "gathering options", "percentComplete": 50},
            ),
            "progress work order",
        )
        _require_body(
            client.top_up_work_order(
                work_order_id,
                {
                    "topUpId": f"topup_{suffix}",
                    "amountCents": 250,
                    "quantity": 1,
                },
            ),
            "work order topup",
        )
        work_order_metering_body = _require_body(
            client.get_work_order_metering(work_order_id, {"includeMeters": True, "limit": 10, "offset": 0}),
            "work order metering",
        )
        complete_body = _require_body(
            client.complete_work_order(
                work_order_id,
                {
                    "outputs": {"itineraryOptions": 3},
                    "metrics": {"latencyMs": 850},
                    "amountCents": 1_500,
                    "currency": "USD",
                },
            ),
            "complete work order",
        )
        completion_receipt = _require_object(complete_body.get("completionReceipt"), "completionReceipt")
        completion_receipt_id = _require_string(completion_receipt.get("receiptId"), "completionReceipt.receiptId")
        receipts_body = _require_body(client.list_work_order_receipts({"workOrderId": work_order_id}), "list work order receipts")
        _require_body(client.get_work_order_receipt(completion_receipt_id), "get work order receipt")

        session = _require_object(
            _require_body(
                client.create_session(
                    {
                        "participants": [principal_agent_id, worker_agent_id],
                        "visibility": "tenant",
                        "metadata": {"topic": "travel coordination"},
                    }
                ),
                "create session",
            ).get("session"),
            "session",
        )
        session_id = _require_string(session.get("sessionId"), "session.sessionId")
        session_events_before = _require_body(client.list_session_events(session_id, {"limit": 5, "offset": 0}), "list session events before")
        raw_prev_chain_hash = session_events_before.get("currentPrevChainHash")
        if isinstance(raw_prev_chain_hash, str) and raw_prev_chain_hash.strip() != "":
            prev_chain_hash = raw_prev_chain_hash.strip()
        elif raw_prev_chain_hash is None:
            prev_chain_hash = "null"
        else:
            raise RuntimeError("session.currentPrevChainHash: expected string|null")
        _require_body(
            client.append_session_event(
                session_id,
                {"eventType": "message", "payload": {"text": "delegate travel booking with budget cap"}},
                expected_prev_chain_hash=prev_chain_hash,
            ),
            "append session event",
        )
        session_events_after = _require_body(client.list_session_events(session_id, {"limit": 10, "offset": 0}), "list session events after")
        _require_body(client.get_session_replay_pack(session_id), "get session replay pack")
        _require_body(client.get_session_transcript(session_id), "get session transcript")

        checkpoint_trace_id = f"trace_checkpoint_{suffix}"
        state_snapshot = json.dumps({"itineraryOptions": 3, "preferredClass": "economy", "budgetCents": 150000})
        diff_a = json.dumps({"field": "itineraryOptions", "previous": 0, "next": 3})
        diff_b = json.dumps({"field": "budgetCents", "previous": 0, "next": 150000})
        state_checkpoint_body = _require_body(
            client.create_state_checkpoint(
                {
                    "ownerAgentId": principal_agent_id,
                    "projectId": f"proj_{suffix}",
                    "sessionId": session_id,
                    "traceId": checkpoint_trace_id,
                    "delegationGrantRef": checkpoint_delegation_grant_id,
                    "authorityGrantRef": authority_grant_id,
                    "stateRef": {
                        "artifactId": f"art_state_{suffix}",
                        "artifactHash": _sha256_hex(state_snapshot),
                        "contentType": "application/json",
                        "uri": f"memory://state/{suffix}",
                    },
                    "diffRefs": [
                        {
                            "artifactId": f"art_diff_a_{suffix}",
                            "artifactHash": _sha256_hex(diff_a),
                            "contentType": "application/json",
                            "uri": f"memory://diff/a/{suffix}",
                        },
                        {
                            "artifactId": f"art_diff_b_{suffix}",
                            "artifactHash": _sha256_hex(diff_b),
                            "contentType": "application/json",
                            "uri": f"memory://diff/b/{suffix}",
                        },
                    ],
                    "metadata": {"source": "sdk-acs-substrate-smoke-py"},
                }
            ),
            "create state checkpoint",
        )
        state_checkpoint = _require_object(state_checkpoint_body.get("stateCheckpoint"), "stateCheckpoint")
        checkpoint_id = _require_string(state_checkpoint.get("checkpointId"), "stateCheckpoint.checkpointId")
        checkpoint_hash = _require_string(state_checkpoint.get("checkpointHash"), "stateCheckpoint.checkpointHash")
        listed_state_checkpoints = _require_body(
            client.list_state_checkpoints(
                {
                    "ownerAgentId": principal_agent_id,
                    "traceId": checkpoint_trace_id,
                    "limit": 10,
                    "offset": 0,
                }
            ),
            "list state checkpoints",
        )
        fetched_state_checkpoint_body = _require_body(client.get_state_checkpoint(checkpoint_id), "get state checkpoint")
        fetched_state_checkpoint = _require_object(fetched_state_checkpoint_body.get("stateCheckpoint"), "fetchedStateCheckpoint")
        checkpoint_delegation_grant_ref = _require_string(
            fetched_state_checkpoint.get("delegationGrantRef"), "fetchedStateCheckpoint.delegationGrantRef"
        )
        checkpoint_authority_grant_ref = _require_string(
            fetched_state_checkpoint.get("authorityGrantRef"), "fetchedStateCheckpoint.authorityGrantRef"
        )

        attestation_result = _require_body(
            client.create_capability_attestation(
                {
                    "subjectAgentId": worker_agent_id,
                    "issuerAgentId": principal_agent_id,
                    "capability": capability_id,
                    "level": "attested",
                    "validity": {"expiresAt": _future_iso(48)},
                }
            ),
            "create capability attestation",
        )
        capability_attestation = _require_object(attestation_result.get("capabilityAttestation"), "capabilityAttestation")
        capability_attestation_id = _require_string(capability_attestation.get("attestationId"), "capabilityAttestation.attestationId")
        list_attestations = _require_body(
            client.list_capability_attestations({"subjectAgentId": worker_agent_id, "capability": capability_id}),
            "list capability attestations",
        )
        get_attestation = _require_body(client.get_capability_attestation(capability_attestation_id), "get capability attestation")
        _require_body(
            client.revoke_capability_attestation(capability_attestation_id, {"reasonCode": "REVOKED_BY_ISSUER"}),
            "revoke capability attestation",
        )

        public_reputation_summary = {
            "agentId": worker_agent_id,
            "relationships": [],
        }
        try:
            public_reputation_summary_body = _require_body(
                client.get_public_agent_reputation_summary(
                    worker_agent_id,
                    {
                        "reputationVersion": "v2",
                        "reputationWindow": "30d",
                        "asOf": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                        "includeRelationships": True,
                        "relationshipLimit": 5,
                    },
                ),
                "get public reputation summary",
            )
            public_reputation_summary = _require_object(public_reputation_summary_body.get("summary"), "publicReputationSummary")
        except NooterraApiError as err:
            if err.code != "PUBLIC_REPUTATION_SUMMARY_DISABLED":
                raise

        interaction_graph_pack_body = _require_body(
            client.get_agent_interaction_graph_pack(
                worker_agent_id,
                {
                    "reputationVersion": "v2",
                    "reputationWindow": "30d",
                    "asOf": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                    "counterpartyAgentId": principal_agent_id,
                    "visibility": "all",
                    "limit": 10,
                    "offset": 0,
                },
            ),
            "get interaction graph pack",
        )
        interaction_graph_pack = _require_object(interaction_graph_pack_body.get("graphPack"), "interactionGraphPack")
        interaction_graph_relationships = (
            interaction_graph_pack.get("relationships") if isinstance(interaction_graph_pack.get("relationships"), list) else []
        )

        relationships_result = _require_body(
            client.list_relationships(
                {
                    "agentId": worker_agent_id,
                    "counterpartyAgentId": principal_agent_id,
                    "reputationWindow": "30d",
                    "asOf": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                    "visibility": "all",
                    "limit": 10,
                    "offset": 0,
                }
            ),
            "list relationships",
        )
        relationships = relationships_result.get("relationships") if isinstance(relationships_result.get("relationships"), list) else []

        revoked_delegation = _require_body(
            client.revoke_delegation_grant(delegation_grant_id, {"reasonCode": "REVOKED_BY_PRINCIPAL"}),
            "revoke delegation grant",
        )
        _require_body(
            client.revoke_delegation_grant(checkpoint_delegation_grant_id, {"reasonCode": "REVOKED_BY_PRINCIPAL"}),
            "revoke checkpoint delegation grant",
        )
        revoked_authority = _require_body(
            client.revoke_authority_grant(authority_grant_id, {"reasonCode": "REVOKED_BY_PRINCIPAL"}),
            "revoke authority grant",
        )

        summary = {
            "principalAgentId": principal_agent_id,
            "workerAgentId": worker_agent_id,
            "tenantDiscoveryCount": len(tenant_discovery.get("results", []) if isinstance(tenant_discovery.get("results"), list) else []),
            "publicDiscoveryCount": len(public_discovery.get("results", []) if isinstance(public_discovery.get("results"), list) else []),
            "delegationGrantId": delegation_grant_id,
            "authorityGrantId": authority_grant_id,
            "workOrderId": work_order_id,
            "workOrderStatus": complete_body.get("workOrder", {}).get("status"),
            "completionReceiptId": completion_receipt_id,
            "completionStatus": completion_receipt.get("status"),
            "workOrderReceiptCount": len(receipts_body.get("receipts", []) if isinstance(receipts_body.get("receipts"), list) else []),
            "workOrderMeterCount": int(
                work_order_metering_body.get("metering", {}).get("meterCount")
                if isinstance(work_order_metering_body.get("metering"), dict)
                and isinstance(work_order_metering_body.get("metering", {}).get("meterCount"), int)
                else 0
            ),
            "workOrderMeterDigest": (
                work_order_metering_body.get("metering", {}).get("meterDigest")
                if isinstance(work_order_metering_body.get("metering"), dict)
                and isinstance(work_order_metering_body.get("metering", {}).get("meterDigest"), str)
                else None
            ),
            "sessionId": session_id,
            "sessionEventCount": len(session_events_after.get("events", []) if isinstance(session_events_after.get("events"), list) else []),
            "checkpointId": checkpoint_id,
            "checkpointHash": checkpoint_hash,
            "checkpointListCount": len(
                listed_state_checkpoints.get("stateCheckpoints", [])
                if isinstance(listed_state_checkpoints.get("stateCheckpoints"), list)
                else []
            ),
            "checkpointDelegationGrantRef": checkpoint_delegation_grant_ref,
            "checkpointAuthorityGrantRef": checkpoint_authority_grant_ref,
            "attestationId": capability_attestation_id,
            "attestationRuntimeStatus": _require_object(get_attestation.get("runtime"), "attestation.runtime").get("status"),
            "attestationListCount": len(list_attestations.get("attestations", []) if isinstance(list_attestations.get("attestations"), list) else []),
            "publicReputationSummaryAgentId": _require_string(public_reputation_summary.get("agentId"), "publicReputationSummary.agentId"),
            "publicReputationRelationshipCount": len(
                public_reputation_summary.get("relationships")
                if isinstance(public_reputation_summary.get("relationships"), list)
                else []
            ),
            "interactionGraphRelationshipCount": len(interaction_graph_relationships),
            "relationshipsCount": len(relationships),
            "delegationRevokedAt": _require_object(revoked_delegation.get("delegationGrant"), "revokedDelegation").get("revocation", {}).get("revokedAt"),
            "authorityRevokedAt": _require_object(revoked_authority.get("authorityGrant"), "revokedAuthority").get("revocation", {}).get("revokedAt"),
        }
        print(json.dumps(summary, indent=2))
        return 0
    except NooterraApiError as err:
        print(json.dumps({"error": "NooterraApiError", "details": err.to_dict()}, indent=2), file=sys.stderr)
        return 2
    except Exception as err:  # noqa: BLE001
        print(json.dumps({"error": "RuntimeError", "message": str(err)}, indent=2), file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
