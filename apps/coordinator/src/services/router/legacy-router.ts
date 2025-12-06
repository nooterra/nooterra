/**
 * Legacy Router
 *
 * Wraps the existing agent selection logic for backwards compatibility.
 * This router is used when USE_COORDINATION_GRAPH=false.
 */

import type {
  Router,
  NootMessage,
  CandidateTarget,
  RouterContext,
  RoutedTarget,
} from "./types.js";
import type { TaskPayload } from "@nooterra/types";
import { selectAgentByCapability } from "../auction.js";

/**
 * Legacy router - uses existing selectAgentByCapability from auction service.
 * This is the pre-NIP-0012 routing logic.
 */
export class LegacyRouter implements Router {
  async selectTargets(
    message: NootMessage,
    candidates: CandidateTarget[],
    context: RouterContext
  ): Promise<RoutedTarget[]> {
    // Extract capability from message payload
    const payload = message.payload as TaskPayload;
    const capability = payload?.capability;

    if (!capability) {
      console.warn("[LegacyRouter] No capability in message payload");
      return [];
    }

    // Use existing auction-based selection
    const selected = await selectAgentByCapability(
      capability,
      context.workflowId,
      [] // No excluded agents for now
    );

    if (!selected) {
      return [];
    }

    // Find the candidate matching the selected agent
    const matchedCandidate = candidates.find(
      (c) => c.agentId === selected.agentDid
    );

    if (matchedCandidate) {
      return [
        {
          agentId: matchedCandidate.agentId,
          capability: matchedCandidate.capability,
          endpoint: matchedCandidate.endpoint,
          weight: 1.0, // Legacy router returns single target with weight 1.0
        },
      ];
    }

    // Fallback: return selected agent even if not in candidates list
    return [
      {
        agentId: selected.agentDid,
        capability,
        endpoint: selected.endpoint,
        weight: 1.0,
      },
    ];
  }
}
