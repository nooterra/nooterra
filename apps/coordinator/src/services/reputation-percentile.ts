/**
 * Reputation Percentile Calculator
 * 
 * Provides relative rankings for agents within each capability domain.
 * Percentiles are more meaningful than raw scores because they account
 * for the distribution of scores in the ecosystem.
 * 
 * Features:
 * - Per-capability percentile rankings
 * - Overall percentile across all agents
 * - Nightly recalculation job
 * - Minimum task threshold for ranking eligibility
 */

import { pool } from "../db.js";

// Minimum tasks to be included in percentile calculations
const MIN_TASKS_FOR_RANKING = Number(process.env.MIN_TASKS_FOR_RANKING || 5);

// How often to recalculate (default: daily at 2 AM)
const RECALC_CRON_HOUR = Number(process.env.PERCENTILE_RECALC_HOUR || 2);

/**
 * Capability score structure stored in capabilityScores JSONB
 */
interface CapabilityScore {
  attempts: number;
  successes: number;
  avgQuality: number;
  avgLatencyMs?: number;
}

/**
 * Result of percentile calculation for logging
 */
export interface PercentileRecalcResult {
  agentsProcessed: number;
  capabilitiesProcessed: number;
  executionTimeMs: number;
  errors: string[];
}

/**
 * Calculate the percentile of a value within a sorted array
 * Uses linear interpolation for smooth percentiles
 */
function calculatePercentile(value: number, sortedValues: number[]): number {
  if (sortedValues.length === 0) return 0.5;
  if (sortedValues.length === 1) return 0.5;
  
  // Find position in sorted array
  let below = 0;
  let equal = 0;
  
  for (const v of sortedValues) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  
  // Percentile = (below + 0.5 * equal) / total
  return (below + 0.5 * equal) / sortedValues.length;
}

/**
 * Recalculate overall percentiles for all agents
 * Based on overall_score field
 */
async function recalculateOverallPercentiles(): Promise<number> {
  const startTime = Date.now();
  
  // Get all agents with minimum tasks
  const result = await pool.query(`
    SELECT agent_did, overall_score
    FROM agent_reputation
    WHERE total_tasks >= $1
    ORDER BY overall_score ASC
  `, [MIN_TASKS_FOR_RANKING]);
  
  if (result.rows.length === 0) {
    console.log("[percentile] No agents meet minimum task threshold for overall percentile");
    return 0;
  }
  
  const sortedScores = result.rows.map(r => parseFloat(r.overall_score));
  
  // Update each agent's overall percentile
  for (let i = 0; i < result.rows.length; i++) {
    const agentDid = result.rows[i].agent_did;
    const score = sortedScores[i];
    const percentile = calculatePercentile(score, sortedScores);
    
    await pool.query(`
      UPDATE agent_reputation
      SET overall_percentile = $2, last_updated = NOW()
      WHERE agent_did = $1
    `, [agentDid, percentile.toFixed(4)]);
  }
  
  // Set agents below threshold to 0.5 (neutral)
  await pool.query(`
    UPDATE agent_reputation
    SET overall_percentile = 0.5
    WHERE total_tasks < $1
  `, [MIN_TASKS_FOR_RANKING]);
  
  console.log(`[percentile] Updated overall percentiles for ${result.rows.length} agents in ${Date.now() - startTime}ms`);
  return result.rows.length;
}

/**
 * Recalculate per-capability percentiles for all agents
 */
async function recalculateCapabilityPercentiles(): Promise<number> {
  const startTime = Date.now();
  
  // Get all agents with capability scores
  const result = await pool.query(`
    SELECT agent_did, capability_scores
    FROM agent_reputation
    WHERE jsonb_typeof(capability_scores) = 'object'
      AND capability_scores != '{}'::jsonb
  `);
  
  if (result.rows.length === 0) {
    console.log("[percentile] No agents have capability scores");
    return 0;
  }
  
  // Build per-capability score maps
  const capabilityScoreMap: Map<string, Array<{ agentDid: string; score: number }>> = new Map();
  
  for (const row of result.rows) {
    const scores = row.capability_scores as Record<string, CapabilityScore>;
    
    for (const [capability, data] of Object.entries(scores)) {
      if (data.attempts < MIN_TASKS_FOR_RANKING) continue;
      
      // Composite score: 70% success rate + 30% quality
      const successRate = data.successes / Math.max(data.attempts, 1);
      const quality = data.avgQuality || 0;
      const compositeScore = 0.7 * successRate + 0.3 * quality;
      
      if (!capabilityScoreMap.has(capability)) {
        capabilityScoreMap.set(capability, []);
      }
      capabilityScoreMap.get(capability)!.push({
        agentDid: row.agent_did,
        score: compositeScore,
      });
    }
  }
  
  // Calculate percentiles for each capability
  let capabilitiesProcessed = 0;
  const agentPercentiles: Map<string, Record<string, number>> = new Map();
  
  for (const [capability, agentScores] of capabilityScoreMap) {
    // Sort by score
    agentScores.sort((a, b) => a.score - b.score);
    const sortedScores = agentScores.map(a => a.score);
    
    // Calculate percentile for each agent
    for (const agent of agentScores) {
      const percentile = calculatePercentile(agent.score, sortedScores);
      
      if (!agentPercentiles.has(agent.agentDid)) {
        agentPercentiles.set(agent.agentDid, {});
      }
      agentPercentiles.get(agent.agentDid)![capability] = parseFloat(percentile.toFixed(4));
    }
    
    capabilitiesProcessed++;
  }
  
  // Update agents with their capability percentiles
  for (const [agentDid, percentiles] of agentPercentiles) {
    await pool.query(`
      UPDATE agent_reputation
      SET capability_percentiles = $2, last_updated = NOW()
      WHERE agent_did = $1
    `, [agentDid, JSON.stringify(percentiles)]);
  }
  
  console.log(`[percentile] Updated capability percentiles for ${agentPercentiles.size} agents across ${capabilitiesProcessed} capabilities in ${Date.now() - startTime}ms`);
  return capabilitiesProcessed;
}

/**
 * Full percentile recalculation (both overall and per-capability)
 * Should be run nightly via cron job
 */
export async function recalculateAllPercentiles(): Promise<PercentileRecalcResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let agentsProcessed = 0;
  let capabilitiesProcessed = 0;
  
  try {
    agentsProcessed = await recalculateOverallPercentiles();
  } catch (err) {
    const msg = `Overall percentile calculation failed: ${err}`;
    console.error(`[percentile] ${msg}`);
    errors.push(msg);
  }
  
  try {
    capabilitiesProcessed = await recalculateCapabilityPercentiles();
  } catch (err) {
    const msg = `Capability percentile calculation failed: ${err}`;
    console.error(`[percentile] ${msg}`);
    errors.push(msg);
  }
  
  return {
    agentsProcessed,
    capabilitiesProcessed,
    executionTimeMs: Date.now() - startTime,
    errors,
  };
}

/**
 * Get an agent's percentile rankings
 */
export async function getAgentPercentiles(agentDid: string): Promise<{
  overall: number;
  capabilities: Record<string, number>;
  eligible: boolean;
}> {
  const result = await pool.query(`
    SELECT overall_percentile, capability_percentiles, total_tasks
    FROM agent_reputation
    WHERE agent_did = $1
  `, [agentDid]);
  
  if (result.rows.length === 0) {
    return {
      overall: 0.5,
      capabilities: {},
      eligible: false,
    };
  }
  
  const row = result.rows[0];
  return {
    overall: parseFloat(row.overall_percentile),
    capabilities: (row.capability_percentiles || {}) as Record<string, number>,
    eligible: row.total_tasks >= MIN_TASKS_FOR_RANKING,
  };
}

/**
 * Get top percentile agents for a specific capability
 */
export async function getTopAgentsForCapability(
  capabilityId: string,
  minPercentile: number = 0.9,
  limit: number = 10
): Promise<Array<{ agentDid: string; percentile: number }>> {
  // Query agents with this capability in their percentiles
  const result = await pool.query(`
    SELECT agent_did, capability_percentiles
    FROM agent_reputation
    WHERE capability_percentiles ? $1
    ORDER BY (capability_percentiles->$1)::numeric DESC
    LIMIT $2
  `, [capabilityId, limit * 2]); // Fetch more to filter
  
  const agents: Array<{ agentDid: string; percentile: number }> = [];
  
  for (const row of result.rows) {
    const percentiles = row.capability_percentiles as Record<string, number>;
    const percentile = percentiles[capabilityId];
    
    if (percentile >= minPercentile) {
      agents.push({
        agentDid: row.agent_did,
        percentile,
      });
    }
    
    if (agents.length >= limit) break;
  }
  
  return agents;
}

/**
 * Start the nightly percentile recalculation job
 */
export function startPercentileRecalcJob(): NodeJS.Timeout {
  const checkAndRun = () => {
    const now = new Date();
    if (now.getHours() === RECALC_CRON_HOUR && now.getMinutes() === 0) {
      console.log("[percentile] Starting nightly percentile recalculation");
      recalculateAllPercentiles()
        .then(result => {
          console.log("[percentile] Nightly recalc complete:", result);
        })
        .catch(err => {
          console.error("[percentile] Nightly recalc failed:", err);
        });
    }
  };
  
  // Check every minute
  const interval = setInterval(checkAndRun, 60000);
  
  console.log(`[percentile] Started nightly recalc job (runs at ${RECALC_CRON_HOUR}:00)`);
  
  return interval;
}

/**
 * Bootstrap function - calculates initial percentiles if needed
 */
export async function bootstrapPercentiles(): Promise<void> {
  // Check if any percentiles have been calculated
  const result = await pool.query(`
    SELECT COUNT(*) as count
    FROM agent_reputation
    WHERE overall_percentile != 0.5
  `);
  
  if (result.rows[0].count === "0") {
    console.log("[percentile] No percentiles calculated yet, running initial calculation");
    await recalculateAllPercentiles();
  }
}
