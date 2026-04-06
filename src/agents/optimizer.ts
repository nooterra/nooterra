/**
 * Self-Optimizing Operations — the meta-agent with world model access.
 *
 * Identifies bottlenecks, proposes new agents for uncovered action classes,
 * optimizes model routing (Opus for judgment, Haiku for routine),
 * and proposes autonomy promotions based on coverage evidence.
 *
 * This is "AI managing AI" done right — not a personified COO,
 * but a governance kernel that allocates resources and maintains health.
 */

import type pg from 'pg';
import { CoverageMap, generateProposals, type CoverageCell, type AuthorityProposal } from '../eval/coverage.js';
import { queryObjects } from '../objects/graph.js';
import { checkAllDeadlines } from '../world-model/ensemble.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OptimizationReport {
  generatedAt: Date;
  tenantId: string;

  /** Fleet health summary */
  health: FleetHealth;
  /** Bottlenecks identified */
  bottlenecks: Bottleneck[];
  /** Recommendations */
  recommendations: Recommendation[];
  /** Autonomy proposals ready for human review */
  autonomyProposals: AuthorityProposal[];
}

export interface FleetHealth {
  totalAgents: number;
  activeAgents: number;
  totalCoveragePercent: number;
  autonomousCoveragePercent: number;
  incidentsLast7d: number;
  avgProceduralScore: number;
  avgOutcomeScore: number;
}

export interface Bottleneck {
  type: 'uncovered_action' | 'approval_queue_growing' | 'low_autonomy' | 'high_cost' | 'model_degradation';
  severity: 'critical' | 'warning' | 'info';
  description: string;
  suggestion: string;
}

export interface Recommendation {
  type: 'create_agent' | 'promote_autonomy' | 'switch_model' | 'adjust_policy' | 'investigate';
  priority: number; // 0-1
  title: string;
  description: string;
  actionRequired: boolean;
}

// ---------------------------------------------------------------------------
// Model routing optimization
// ---------------------------------------------------------------------------

export interface ModelRoutingConfig {
  actionClass: string;
  currentModel: string;
  recommendedModel: string;
  reason: string;
  estimatedSavingsPercent: number;
}

/**
 * Analyze execution patterns and recommend model routing changes.
 * High-judgment tasks → Opus. Routine tasks → Haiku. Save money without losing quality.
 */
export function optimizeModelRouting(
  coverageCells: CoverageCell[],
): ModelRoutingConfig[] {
  const recommendations: ModelRoutingConfig[] = [];

  for (const cell of coverageCells) {
    if (cell.totalExecutions < 10) continue; // not enough data

    // If procedural + outcome scores are consistently high (>0.9),
    // the task is routine — Haiku can handle it
    if (cell.avgProceduralScore > 0.92 && cell.avgOutcomeScore > 0.88 && cell.incidentCount === 0) {
      if (cell.actionClass.startsWith('communicate.email') || cell.actionClass === 'data.read') {
        recommendations.push({
          actionClass: cell.actionClass,
          currentModel: 'anthropic/claude-sonnet-4-6',
          recommendedModel: 'anthropic/claude-haiku-4-5',
          reason: `${cell.totalExecutions} executions at ${(cell.avgProceduralScore * 100).toFixed(0)}% procedural — routine enough for Haiku`,
          estimatedSavingsPercent: 70,
        });
      }
    }

    // If outcome scores are low despite good procedural scores,
    // the task needs stronger reasoning — Opus
    if (cell.avgProceduralScore > 0.85 && cell.avgOutcomeScore < 0.6 && cell.totalExecutions > 20) {
      recommendations.push({
        actionClass: cell.actionClass,
        currentModel: 'anthropic/claude-sonnet-4-6',
        recommendedModel: 'anthropic/claude-opus-4-6',
        reason: `Good procedure (${(cell.avgProceduralScore * 100).toFixed(0)}%) but poor outcomes (${(cell.avgOutcomeScore * 100).toFixed(0)}%) — needs stronger reasoning`,
        estimatedSavingsPercent: -200, // costs more
      });
    }
  }

  return recommendations;
}

// ---------------------------------------------------------------------------
// Bottleneck detection
// ---------------------------------------------------------------------------

/**
 * Scan the system for bottlenecks and inefficiencies.
 */
export function detectBottlenecks(
  coverageCells: CoverageCell[],
  agentActionClasses: Map<string, string[]>,
  pendingEscrowCount: number,
): Bottleneck[] {
  const bottlenecks: Bottleneck[] = [];

  // Find action classes with no agent coverage
  const coveredActionClasses = new Set(coverageCells.map(c => c.actionClass));
  const allKnownClasses = new Set<string>();
  for (const classes of agentActionClasses.values()) {
    for (const c of classes) allKnownClasses.add(c);
  }
  // Check if there are objects that need action classes no agent covers
  // (This would need object graph analysis — simplified here)

  // Approval queue growing
  if (pendingEscrowCount > 10) {
    bottlenecks.push({
      type: 'approval_queue_growing',
      severity: pendingEscrowCount > 25 ? 'critical' : 'warning',
      description: `${pendingEscrowCount} actions waiting for approval — queue is growing`,
      suggestion: 'Review autonomy promotions. Several action classes may be ready for auto_with_review.',
    });
  }

  // Low autonomy across the board
  const autonomousCells = coverageCells.filter(c => c.currentLevel === 'autonomous');
  const totalCells = coverageCells.filter(c => c.totalExecutions > 0);
  if (totalCells.length > 3 && autonomousCells.length === 0) {
    bottlenecks.push({
      type: 'low_autonomy',
      severity: 'info',
      description: 'No action classes are fully autonomous yet — all actions require some human involvement',
      suggestion: 'Check the autonomy map for cells with strong evidence that could be promoted.',
    });
  }

  // Cells with many executions still at human_approval
  for (const cell of coverageCells) {
    if (cell.currentLevel === 'human_approval' && cell.totalExecutions > 30 &&
        cell.avgProceduralScore > 0.85 && cell.incidentCount === 0) {
      bottlenecks.push({
        type: 'low_autonomy',
        severity: 'warning',
        description: `${cell.actionClass} for ${cell.agentId}: ${cell.totalExecutions} executions at ${(cell.avgProceduralScore * 100).toFixed(0)}% procedural but still requires human approval`,
        suggestion: `Consider promoting to auto_with_review — evidence is strong.`,
      });
    }
  }

  // High cost agents
  // (Would need cost data from execution traces — simplified)

  return bottlenecks;
}

// ---------------------------------------------------------------------------
// Full optimization report
// ---------------------------------------------------------------------------

/**
 * Generate a full optimization report for a tenant.
 * This is what the meta-agent produces on each monitoring cycle.
 */
export function generateOptimizationReport(
  tenantId: string,
  coverageMap: CoverageMap,
  agentConfigs: { id: string; actionClasses: string[] }[],
  pendingEscrowCount: number,
  options: {
    coverageCells?: CoverageCell[];
    autonomyProposals?: AuthorityProposal[];
  } = {},
): OptimizationReport {
  const allCoverage = options.coverageCells ?? coverageMap.getAllCoverage();
  const agentCoverage = new Map<string, CoverageCell[]>();

  for (const cell of allCoverage) {
    if (!agentCoverage.has(cell.agentId)) agentCoverage.set(cell.agentId, []);
    agentCoverage.get(cell.agentId)!.push(cell);
  }

  // Fleet health
  const activeCells = allCoverage.filter(c => c.totalExecutions > 0);
  const autonomousCells = allCoverage.filter(c => c.currentLevel === 'autonomous');
  const totalExecutions = allCoverage.reduce((sum, c) => sum + c.totalExecutions, 0);
  const weightedProcedural = totalExecutions > 0
    ? allCoverage.reduce((sum, c) => sum + c.avgProceduralScore * c.totalExecutions, 0) / totalExecutions
    : 0;
  const weightedOutcome = totalExecutions > 0
    ? allCoverage.reduce((sum, c) => sum + c.avgOutcomeScore * c.totalExecutions, 0) / totalExecutions
    : 0;

  const health: FleetHealth = {
    totalAgents: agentConfigs.length,
    activeAgents: agentCoverage.size,
    totalCoveragePercent: activeCells.length > 0 ? (activeCells.length / Math.max(allCoverage.length, 1)) * 100 : 0,
    autonomousCoveragePercent: autonomousCells.length > 0 ? (autonomousCells.length / Math.max(activeCells.length, 1)) * 100 : 0,
    incidentsLast7d: allCoverage.reduce((sum, c) => sum + c.incidentCount, 0),
    avgProceduralScore: weightedProcedural,
    avgOutcomeScore: weightedOutcome,
  };

  // Bottlenecks
  const agentActionMap = new Map(agentConfigs.map(a => [a.id, a.actionClasses]));
  const bottlenecks = detectBottlenecks(allCoverage, agentActionMap, pendingEscrowCount);

  // Model routing recommendations
  const modelRecs = optimizeModelRouting(allCoverage);

  // Build recommendations
  const recommendations: Recommendation[] = [];

  for (const bottleneck of bottlenecks) {
    recommendations.push({
      type: bottleneck.type === 'approval_queue_growing' ? 'promote_autonomy' :
            bottleneck.type === 'low_autonomy' ? 'promote_autonomy' : 'investigate',
      priority: bottleneck.severity === 'critical' ? 0.9 : bottleneck.severity === 'warning' ? 0.6 : 0.3,
      title: bottleneck.description.slice(0, 80),
      description: bottleneck.suggestion,
      actionRequired: bottleneck.severity !== 'info',
    });
  }

  for (const rec of modelRecs) {
    recommendations.push({
      type: 'switch_model',
      priority: rec.estimatedSavingsPercent > 50 ? 0.5 : 0.3,
      title: `Switch ${rec.actionClass} to ${rec.recommendedModel.split('/')[1]}`,
      description: rec.reason,
      actionRequired: false,
    });
  }

  recommendations.sort((a, b) => b.priority - a.priority);

  // Autonomy proposals
  const autonomyProposals = options.autonomyProposals ?? generateProposals(coverageMap);

  return {
    generatedAt: new Date(),
    tenantId,
    health,
    bottlenecks,
    recommendations,
    autonomyProposals,
  };
}
