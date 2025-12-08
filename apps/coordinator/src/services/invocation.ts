import crypto from "crypto";
import type {
  Invocation,
  InvocationConstraints,
  InvocationContext,
} from "@nooterra/types";

interface BuildInvocationParams {
  workflowId: string;
  nodeName: string;
  capabilityId: string;
  input: unknown;
  traceId: string | null | undefined;
  payerDid?: string | null;
  projectId?: string | null;
  maxPriceCents?: number | null;
  budgetCapCents?: number | null;
  timeoutMs?: number | null;
  targetAgentId?: string | null;
  deadlineAt?: string | null;
  policyIds?: string[] | null;
  regionsAllow?: string[] | null;
  regionsDeny?: string[] | null;
}

export function buildInvocation(params: BuildInvocationParams): Invocation {
  const {
    workflowId,
    nodeName,
    capabilityId,
    input,
    traceId,
    payerDid,
    projectId,
    maxPriceCents,
    budgetCapCents,
    timeoutMs,
    targetAgentId,
    deadlineAt,
    policyIds,
    regionsAllow,
    regionsDeny,
  } = params;

  const invocationId = crypto.randomUUID();

  const constraints: InvocationConstraints = {};
  if (typeof timeoutMs === "number") constraints.timeoutMs = timeoutMs;
  if (typeof maxPriceCents === "number") constraints.maxPriceCents = maxPriceCents;
  if (typeof budgetCapCents === "number") constraints.budgetCapCents = budgetCapCents;
  if (deadlineAt) constraints.deadlineAt = deadlineAt;
  if (policyIds && policyIds.length) constraints.policyIds = policyIds;
  if (regionsAllow && regionsAllow.length) constraints.regionsAllow = regionsAllow;
  if (regionsDeny && regionsDeny.length) constraints.regionsDeny = regionsDeny;

  const context: InvocationContext = {
    workflowId,
    nodeName,
    payerDid: payerDid || undefined,
    projectId: projectId || undefined,
  };

  return {
    invocationId,
    traceId: traceId || workflowId,
    capabilityId,
    agentDid: targetAgentId || undefined,
    input,
    constraints: Object.keys(constraints).length ? constraints : undefined,
    context,
  };
}

