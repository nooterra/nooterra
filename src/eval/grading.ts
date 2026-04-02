/**
 * Trace Grading — two-dimensional evaluation of agent execution traces.
 *
 * Procedural grading: did the agent follow the right process?
 *   - Policy compliance: did it stay within authority?
 *   - Context utilization: did it use the available information?
 *   - Tool use correctness: did it call the right tools with right args?
 *   - Disclosure compliance: did it follow disclosure rules?
 *
 * Outcome grading: did the intended objective happen?
 *   - Objective achieved: did the goal get accomplished?
 *   - Side effects: were there unexpected consequences?
 *   - Cost efficiency: was the cost reasonable?
 *
 * An agent that gets lucky with a sloppy process should NOT be promoted.
 * An agent that follows perfect procedure but hits an unlikely outcome
 * should NOT be demoted. Both dimensions matter.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionTrace {
  executionId: string;
  agentId: string;
  tenantId: string;
  actionClass: string;
  targetObjectId: string;

  // What happened
  actionsProposed: TraceAction[];
  actionsExecuted: TraceAction[];
  actionsBlocked: TraceAction[];
  actionsEscrowed: TraceAction[];

  // Context that was provided
  contextProvided: boolean;
  authorityChecked: boolean;
  disclosureAppended: boolean;

  // Costs
  tokensUsed: number;
  costCents: number;
  durationMs: number;

  // Outcome (filled later when effects are observed)
  objectiveAchieved?: boolean;
  sideEffects?: string[];
}

export interface TraceAction {
  actionClass: string;
  tool: string;
  status: 'executed' | 'denied' | 'escrowed';
  reason?: string;
  evidenceComplete: boolean;
}

export interface TraceGrade {
  executionId: string;
  agentId: string;

  // Procedural grading
  procedural: {
    policyCompliance: number;      // 0-1
    contextUtilization: number;    // 0-1
    toolUseCorrectness: number;    // 0-1
    disclosureCompliance: number;  // 0-1
    overall: number;               // weighted average
  };

  // Outcome grading
  outcome: {
    objectiveAchieved: number;     // 0-1
    sideEffects: number;           // 0-1 (1 = no side effects)
    costEfficiency: number;        // 0-1
    overall: number;               // weighted average
  };

  // Combined
  overallGrade: number;            // procedural * 0.5 + outcome * 0.5
  issues: GradeIssue[];
  gradedAt: Date;
}

export interface GradeIssue {
  severity: 'critical' | 'warning' | 'info';
  category: 'procedural' | 'outcome';
  description: string;
}

// ---------------------------------------------------------------------------
// Procedural grading
// ---------------------------------------------------------------------------

function gradeProcedural(trace: ExecutionTrace): {
  scores: TraceGrade['procedural'];
  issues: GradeIssue[];
} {
  const issues: GradeIssue[] = [];

  // Policy compliance: were any actions blocked?
  let policyCompliance = 1.0;
  if (trace.actionsBlocked.length > 0) {
    // Each blocked action reduces compliance
    policyCompliance -= trace.actionsBlocked.length * 0.2;
    for (const blocked of trace.actionsBlocked) {
      issues.push({
        severity: 'warning',
        category: 'procedural',
        description: `Action blocked: ${blocked.tool} — ${blocked.reason ?? 'policy violation'}`,
      });
    }
  }
  policyCompliance = Math.max(0, policyCompliance);

  // Context utilization: did the agent have context and authority?
  let contextUtilization = 0.5;
  if (trace.contextProvided) contextUtilization += 0.3;
  if (trace.authorityChecked) contextUtilization += 0.2;
  if (!trace.contextProvided) {
    issues.push({
      severity: 'warning',
      category: 'procedural',
      description: 'Agent executed without context from the world model',
    });
  }

  // Tool use correctness: did executed actions have complete evidence?
  let toolUseCorrectness = 1.0;
  const executed = [...trace.actionsExecuted, ...trace.actionsEscrowed];
  if (executed.length > 0) {
    const withEvidence = executed.filter(a => a.evidenceComplete).length;
    toolUseCorrectness = withEvidence / executed.length;
    if (toolUseCorrectness < 1.0) {
      issues.push({
        severity: 'info',
        category: 'procedural',
        description: `${executed.length - withEvidence}/${executed.length} actions had incomplete evidence bundles`,
      });
    }
  }

  // Disclosure compliance
  let disclosureCompliance = 1.0;
  if (!trace.disclosureAppended) {
    // Check if any communication actions were taken
    const commActions = executed.filter(a => a.actionClass.startsWith('communicate.'));
    if (commActions.length > 0) {
      disclosureCompliance = 0.0;
      issues.push({
        severity: 'critical',
        category: 'procedural',
        description: 'Communication sent without required AI disclosure',
      });
    }
  }

  const overall = policyCompliance * 0.35
    + contextUtilization * 0.20
    + toolUseCorrectness * 0.25
    + disclosureCompliance * 0.20;

  return {
    scores: { policyCompliance, contextUtilization, toolUseCorrectness, disclosureCompliance, overall },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Outcome grading
// ---------------------------------------------------------------------------

function gradeOutcome(trace: ExecutionTrace, avgCostCents?: number): {
  scores: TraceGrade['outcome'];
  issues: GradeIssue[];
} {
  const issues: GradeIssue[] = [];

  // Objective achieved
  let objectiveAchieved = 0.5; // default: unknown
  if (trace.objectiveAchieved === true) {
    objectiveAchieved = 1.0;
  } else if (trace.objectiveAchieved === false) {
    objectiveAchieved = 0.0;
    issues.push({
      severity: 'warning',
      category: 'outcome',
      description: 'Objective was not achieved',
    });
  }
  // If undefined → remains 0.5 (outcome not yet observed)

  // Side effects
  let sideEffects = 1.0; // 1 = no side effects
  if (trace.sideEffects && trace.sideEffects.length > 0) {
    sideEffects = Math.max(0, 1 - trace.sideEffects.length * 0.25);
    for (const effect of trace.sideEffects) {
      issues.push({
        severity: 'warning',
        category: 'outcome',
        description: `Unintended side effect: ${effect}`,
      });
    }
  }

  // Cost efficiency
  let costEfficiency = 0.8; // default: reasonable
  if (avgCostCents && avgCostCents > 0) {
    const ratio = trace.costCents / avgCostCents;
    if (ratio > 3) {
      costEfficiency = 0.2;
      issues.push({ severity: 'warning', category: 'outcome', description: `Cost ${ratio.toFixed(1)}x average` });
    } else if (ratio > 2) {
      costEfficiency = 0.4;
    } else if (ratio > 1.5) {
      costEfficiency = 0.6;
    } else if (ratio < 0.5) {
      costEfficiency = 1.0; // cheaper than average is great
    }
  }

  const overall = objectiveAchieved * 0.50
    + sideEffects * 0.30
    + costEfficiency * 0.20;

  return {
    scores: { objectiveAchieved, sideEffects, costEfficiency, overall },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Main grading function
// ---------------------------------------------------------------------------

/**
 * Grade an execution trace on both procedural and outcome dimensions.
 */
export function gradeTrace(trace: ExecutionTrace, avgCostCents?: number): TraceGrade {
  const proc = gradeProcedural(trace);
  const out = gradeOutcome(trace, avgCostCents);

  const overallGrade = proc.scores.overall * 0.5 + out.scores.overall * 0.5;

  return {
    executionId: trace.executionId,
    agentId: trace.agentId,
    procedural: proc.scores,
    outcome: out.scores,
    overallGrade,
    issues: [...proc.issues, ...out.issues],
    gradedAt: new Date(),
  };
}
