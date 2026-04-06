/**
 * Autonomy Coverage Map — trust is not a number, it's a map.
 *
 * Tracks per agent × per action class × per condition:
 * - Total executions with evidence
 * - Success rate, procedural score, outcome score
 * - Current autonomy level
 * - Recommended level with evidence strength
 *
 * Promotion requires evidence: N executions with procedural > 0.9 and outcome > 0.8.
 * Demotion is asymmetric: one serious incident triggers immediate suspension.
 */

import type { TraceGrade } from './grading.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutonomyLevel = 'forbidden' | 'human_approval' | 'auto_with_review' | 'autonomous';

export interface CoverageCell {
  tenantId: string;
  agentId: string;
  actionClass: string;
  objectType: string;

  // Evidence
  totalExecutions: number;
  successfulExecutions: number;
  successRate: number;
  avgProceduralScore: number;
  avgOutcomeScore: number;
  lastFailureAt?: Date;
  incidentCount: number;

  // Current level
  currentLevel: AutonomyLevel;

  // Recommendation
  recommendedLevel: AutonomyLevel;
  evidenceStrength: number;       // 0-1: how confident is the recommendation
  requiredForPromotion: string;   // what's still needed
}

export interface AuthorityProposal {
  agentId: string;
  actionClass: string;
  objectType: string;
  fromLevel: AutonomyLevel;
  toLevel: AutonomyLevel;
  evidence: {
    totalExecutions: number;
    successRate: number;
    avgProceduralScore: number;
    avgOutcomeScore: number;
    incidentCount: number;
  };
  confidence: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Promotion/demotion thresholds
// ---------------------------------------------------------------------------

const PROMOTION_THRESHOLDS = {
  // human_approval → auto_with_review
  toAutoWithReview: {
    minExecutions: 20,
    minProceduralScore: 0.85,
    minOutcomeScore: 0.75,
    maxIncidents: 1,
  },
  // auto_with_review → autonomous
  toAutonomous: {
    minExecutions: 50,
    minProceduralScore: 0.90,
    minOutcomeScore: 0.80,
    maxIncidents: 0,
  },
};

const DEMOTION_THRESHOLDS = {
  // Any critical incident → immediate suspension
  criticalIncidentCount: 1,
  // Procedural score drops → demote
  minProceduralScore: 0.5,
  // Outcome score drops → demote
  minOutcomeScore: 0.4,
};

// ---------------------------------------------------------------------------
// Coverage Map
// ---------------------------------------------------------------------------

export class CoverageMap {
  private cells = new Map<string, CoverageCell>();

  private key(tenantId: string, agentId: string, actionClass: string, objectType: string): string {
    return `${tenantId}:${agentId}:${actionClass}:${objectType}`;
  }

  private sortCells(cells: CoverageCell[]): CoverageCell[] {
    return [...cells].sort((left, right) =>
      String(left.agentId).localeCompare(String(right.agentId)) ||
      String(left.actionClass).localeCompare(String(right.actionClass)) ||
      String(left.objectType).localeCompare(String(right.objectType)),
    );
  }

  /** Get or create a coverage cell */
  getCell(agentId: string, actionClass: string, objectType: string, tenantId = 'tenant_default'): CoverageCell {
    const k = this.key(tenantId, agentId, actionClass, objectType);
    if (!this.cells.has(k)) {
      this.cells.set(k, {
        tenantId,
        agentId,
        actionClass,
        objectType,
        totalExecutions: 0,
        successfulExecutions: 0,
        successRate: 0,
        avgProceduralScore: 0,
        avgOutcomeScore: 0,
        incidentCount: 0,
        currentLevel: 'human_approval', // default: supervised
        recommendedLevel: 'human_approval',
        evidenceStrength: 0,
        requiredForPromotion: `Need ${PROMOTION_THRESHOLDS.toAutoWithReview.minExecutions} executions with procedural > ${PROMOTION_THRESHOLDS.toAutoWithReview.minProceduralScore}`,
      });
    }
    return this.cells.get(k)!;
  }

  /** Record a graded execution */
  recordExecution(
    agentId: string,
    actionClass: string,
    objectType: string,
    grade: TraceGrade,
    tenantId = 'tenant_default',
  ): void {
    const cell = this.getCell(agentId, actionClass, objectType, tenantId);

    cell.totalExecutions++;
    if (grade.overallGrade >= 0.7) {
      cell.successfulExecutions++;
    }
    cell.successRate = cell.successfulExecutions / cell.totalExecutions;

    // Running average of scores
    const n = cell.totalExecutions;
    cell.avgProceduralScore = ((cell.avgProceduralScore * (n - 1)) + grade.procedural.overall) / n;
    cell.avgOutcomeScore = ((cell.avgOutcomeScore * (n - 1)) + grade.outcome.overall) / n;

    // Track incidents (critical issues)
    const criticalIssues = grade.issues.filter(i => i.severity === 'critical');
    if (criticalIssues.length > 0) {
      cell.incidentCount += criticalIssues.length;
      cell.lastFailureAt = new Date();
    }

    // Update recommendation
    this.updateRecommendation(cell);
  }

  /** Record an incident (demotion trigger) */
  recordIncident(agentId: string, actionClass: string, objectType: string, tenantId = 'tenant_default'): void {
    const cell = this.getCell(agentId, actionClass, objectType, tenantId);
    cell.incidentCount++;
    cell.lastFailureAt = new Date();
    this.updateRecommendation(cell);
  }

  /** Update the recommended level based on evidence */
  private updateRecommendation(cell: CoverageCell): void {
    // Check for demotion first (faster than promotion)
    if (cell.incidentCount >= DEMOTION_THRESHOLDS.criticalIncidentCount &&
        (cell.currentLevel === 'autonomous' || cell.currentLevel === 'auto_with_review')) {
      cell.recommendedLevel = 'human_approval';
      cell.evidenceStrength = 0.95;
      cell.requiredForPromotion = `${cell.incidentCount} incident(s) detected — demoted to human_approval`;
      return;
    }
    if (cell.avgProceduralScore < DEMOTION_THRESHOLDS.minProceduralScore && cell.totalExecutions >= 5) {
      cell.recommendedLevel = 'human_approval';
      cell.evidenceStrength = 0.8;
      cell.requiredForPromotion = `Procedural score ${cell.avgProceduralScore.toFixed(2)} below threshold ${DEMOTION_THRESHOLDS.minProceduralScore}`;
      return;
    }

    // Check for promotion
    if (cell.currentLevel === 'human_approval') {
      const thresh = PROMOTION_THRESHOLDS.toAutoWithReview;
      if (cell.totalExecutions >= thresh.minExecutions &&
          cell.avgProceduralScore >= thresh.minProceduralScore &&
          cell.avgOutcomeScore >= thresh.minOutcomeScore &&
          cell.incidentCount <= thresh.maxIncidents) {
        cell.recommendedLevel = 'auto_with_review';
        cell.evidenceStrength = Math.min(1, cell.totalExecutions / (thresh.minExecutions * 2));
        cell.requiredForPromotion = 'Meets promotion criteria — ready for auto_with_review';
        return;
      }
      // Not enough evidence yet
      const missing: string[] = [];
      if (cell.totalExecutions < thresh.minExecutions) {
        missing.push(`${thresh.minExecutions - cell.totalExecutions} more executions`);
      }
      if (cell.avgProceduralScore < thresh.minProceduralScore) {
        missing.push(`procedural score ${cell.avgProceduralScore.toFixed(2)} → ${thresh.minProceduralScore}`);
      }
      if (cell.avgOutcomeScore < thresh.minOutcomeScore) {
        missing.push(`outcome score ${cell.avgOutcomeScore.toFixed(2)} → ${thresh.minOutcomeScore}`);
      }
      cell.recommendedLevel = 'human_approval';
      cell.evidenceStrength = cell.totalExecutions / thresh.minExecutions;
      cell.requiredForPromotion = `Need: ${missing.join(', ')}`;
      return;
    }

    if (cell.currentLevel === 'auto_with_review') {
      const thresh = PROMOTION_THRESHOLDS.toAutonomous;
      if (cell.totalExecutions >= thresh.minExecutions &&
          cell.avgProceduralScore >= thresh.minProceduralScore &&
          cell.avgOutcomeScore >= thresh.minOutcomeScore &&
          cell.incidentCount <= thresh.maxIncidents) {
        cell.recommendedLevel = 'autonomous';
        cell.evidenceStrength = Math.min(1, cell.totalExecutions / (thresh.minExecutions * 2));
        cell.requiredForPromotion = 'Meets promotion criteria — ready for full autonomy';
        return;
      }
      const missing: string[] = [];
      if (cell.totalExecutions < thresh.minExecutions) {
        missing.push(`${thresh.minExecutions - cell.totalExecutions} more executions`);
      }
      if (cell.avgProceduralScore < thresh.minProceduralScore) {
        missing.push(`procedural ${cell.avgProceduralScore.toFixed(2)} → ${thresh.minProceduralScore}`);
      }
      cell.recommendedLevel = 'auto_with_review';
      cell.evidenceStrength = cell.totalExecutions / thresh.minExecutions;
      cell.requiredForPromotion = `Need: ${missing.join(', ')}`;
    }
  }

  /** Get all cells for an agent (the full coverage map) */
  getAgentCoverage(agentId: string, tenantId?: string): CoverageCell[] {
    return this.sortCells(
      [...this.cells.values()].filter((c) => c.agentId === agentId && (!tenantId || c.tenantId === tenantId)),
    );
  }

  /** Get all cells (full system view) */
  getAllCoverage(tenantId?: string): CoverageCell[] {
    return this.sortCells([...this.cells.values()].filter((c) => !tenantId || c.tenantId === tenantId));
  }

  /** Get all cells for a tenant */
  getTenantCoverage(tenantId: string): CoverageCell[] {
    return this.getAllCoverage(tenantId);
  }

  /** Clear all in-memory coverage state. Useful for deterministic tests. */
  clear(): void {
    this.cells.clear();
  }

  /** Apply a promotion (human-approved level change) */
  applyPromotion(agentId: string, actionClass: string, objectType: string, newLevel: AutonomyLevel, tenantId = 'tenant_default'): void {
    const cell = this.getCell(agentId, actionClass, objectType, tenantId);
    cell.currentLevel = newLevel;
    this.updateRecommendation(cell);
  }
}

// ---------------------------------------------------------------------------
// Authority proposals
// ---------------------------------------------------------------------------

/**
 * Generate authority change proposals from the coverage map.
 * Returns proposals where recommendedLevel differs from currentLevel.
 */
export function generateProposals(coverageMap: CoverageMap): AuthorityProposal[] {
  return generateProposalsFromCells(coverageMap.getAllCoverage());
}

export function generateTenantProposals(coverageMap: CoverageMap, tenantId: string): AuthorityProposal[] {
  return generateProposalsFromCells(coverageMap.getTenantCoverage(tenantId));
}

export function generateProposalsFromCells(cells: CoverageCell[]): AuthorityProposal[] {
  const proposals: AuthorityProposal[] = [];

  for (const cell of cells) {
    if (cell.recommendedLevel === cell.currentLevel) continue;
    if (cell.evidenceStrength < 0.5) continue; // Not enough evidence to propose

    const isPromotion = levelRank(cell.recommendedLevel) > levelRank(cell.currentLevel);
    const isDemotion = levelRank(cell.recommendedLevel) < levelRank(cell.currentLevel);

    proposals.push({
      agentId: cell.agentId,
      actionClass: cell.actionClass,
      objectType: cell.objectType,
      fromLevel: cell.currentLevel,
      toLevel: cell.recommendedLevel,
      evidence: {
        totalExecutions: cell.totalExecutions,
        successRate: cell.successRate,
        avgProceduralScore: cell.avgProceduralScore,
        avgOutcomeScore: cell.avgOutcomeScore,
        incidentCount: cell.incidentCount,
      },
      confidence: cell.evidenceStrength,
      reason: isPromotion
        ? `${cell.totalExecutions} executions with ${(cell.avgProceduralScore * 100).toFixed(0)}% procedural, ${(cell.avgOutcomeScore * 100).toFixed(0)}% outcome`
        : isDemotion
        ? `${cell.incidentCount} incident(s), procedural: ${(cell.avgProceduralScore * 100).toFixed(0)}%`
        : cell.requiredForPromotion,
    });
  }

  return proposals;
}

function levelRank(level: AutonomyLevel): number {
  const ranks: Record<AutonomyLevel, number> = {
    forbidden: 0,
    human_approval: 1,
    auto_with_review: 2,
    autonomous: 3,
  };
  return ranks[level];
}
