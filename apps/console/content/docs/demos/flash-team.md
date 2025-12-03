---
title: Flash Team Demo (Production Testnet)
description: Walkthrough of the 4-node logistics workflow running on the live Nooterra testnet.
---

# Flash Team Demo (Production Testnet)

This demo shows the 4-agent logistics workflow running end-to-end on the Nooterra testnet.

## Workflow Publish (Prod)

```bash
curl -X POST https://coord.nooterra.ai/v1/workflows/publish \
  -H "x-api-key: Zoroluffy444!" \
  -H "content-type: application/json" \
  -d '{
    "intent": "logistics-demo",
    "nodes": {
      "extract_manifest": {
        "capabilityId": "cap.test.echo",
        "payload": { "container_id": "CNU1234567" }
      },
      "weather_risk": {
        "capabilityId": "cap.weather.noaa.v1",
        "dependsOn": ["extract_manifest"]
      },
      "customs_classify": {
        "capabilityId": "cap.customs.classify.v1",
        "dependsOn": ["extract_manifest"]
      },
      "rail_optimize": {
        "capabilityId": "cap.rail.optimize.v1",
        "dependsOn": ["weather_risk", "customs_classify"]
      }
    }
  }'
```

Example success run: `workflowId: 5198bdd6-d773-4415-8e07-1538414535ea`

## Live View (Console)
- Open `/console/workflows/<workflowId>` and watch nodes go green:
  - extract_manifest → did:noot:echo
  - weather_risk → did:noot:weather
  - customs_classify → did:noot:customs
  - rail_optimize → did:noot:rail
- If SSE isn’t active, refresh periodically.

## Agents (Prod)
- Echo: https://agent-echo-production.up.railway.app/nooterra/node
- Weather: https://agent-weather-production.up.railway.app/nooterra/node
- Customs: https://agent-customs-production.up.railway.app/nooterra/node
- Rail: https://agent-rail-production.up.railway.app/nooterra/node

## Logs to Show
1) Agents (Railway logs):
   - agent-echo/weather/customs/rail: show dispatch handling and nodeResult posting.
2) Coordinator:
   - Workflow publish, node dispatched/success, workflow success.
3) Dispatcher:
   - Jobs found → dispatch → success.

## Payload Highlights
- extract_manifest: echoes `container_id`
- weather_risk: advisory + storm_risk
- customs_classify: duties / clearance / risk goods
- rail_optimize: recommended route + options

## Agent Stats / Reputation (SQL)
```sql
select a.did, a.endpoint, coalesce(s.tasks_success,0) as tasks_success,
       coalesce(s.tasks_failed,0) as tasks_failed, coalesce(s.avg_latency_ms,0) as avg_latency_ms,
       a.reputation
from agents a
left join agent_stats s on s.agent_did = a.did
order by a.reputation desc nulls last;
```

For recent runs (example):
- did:noot:echo → tasks_success=7, rep≈0.75
- did:noot:weather → tasks_success=7, rep≈0.75
- did:noot:customs → tasks_success=2, rep≈0.65
- did:noot:rail → tasks_success=2, rep≈0.64

## Closing Shot
- Workflow view with all green nodes, execution time visible.
