import { pool } from "../db.js";

const VERIFICATION_ALPHA = 0.2;

interface OverallInputs {
  successRate: number;
  verificationScore: number;
  pageRank: number;
  coalitionScore: number;
  totalTasks: number;
}

function calculateOverallScoreFromInputs(rep: OverallInputs): number {
  const weights = {
    successRate: 0.35,
    verification: 0.2,
    pageRank: 0.25,
    coalition: 0.1,
    experience: 0.1,
  };

  const experienceFactor = Math.min(rep.totalTasks / 100, 1);
  const normalizedPageRank = Math.min(rep.pageRank * 100, 1);

  const score =
    rep.successRate * weights.successRate +
    rep.verificationScore * weights.verification +
    normalizedPageRank * weights.pageRank +
    rep.coalitionScore * weights.coalition +
    experienceFactor * weights.experience;

  return Math.max(0, Math.min(1, score));
}

/**
 * Soft-update an agent's verification_score and overall_score based on
 * verifier compliance results. This uses an exponential moving average
 * toward 1 for compliant invocations and toward 0 for non-compliant ones.
 */
export async function updateVerificationScoreFromCompliance(
  agentDid: string,
  compliant: boolean
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const repRes = await client.query(
      `insert into agent_reputation (agent_did)
         values ($1)
         on conflict (agent_did) do update set last_updated = now()
       returning *`,
      [agentDid]
    );

    const rep = repRes.rows[0] as any;

    const currentVs =
      rep.verification_score != null
        ? parseFloat(rep.verification_score)
        : 0.5;
    const target = compliant ? 1 : 0;
    const newVs =
      currentVs + VERIFICATION_ALPHA * (target - currentVs);

    const successRate =
      rep.success_rate != null ? parseFloat(rep.success_rate) : 0;
    const pageRank =
      rep.page_rank != null ? parseFloat(rep.page_rank) : 0;
    const coalitionScore =
      rep.coalition_score != null
        ? parseFloat(rep.coalition_score)
        : 0.5;
    const totalTasks = rep.total_tasks ?? 0;

    const overall = calculateOverallScoreFromInputs({
      successRate,
      verificationScore: newVs,
      pageRank,
      coalitionScore,
      totalTasks,
    });

    await client.query(
      `update agent_reputation
          set verification_score = $2,
              overall_score = $3,
              last_updated = now()
        where agent_did = $1`,
      [agentDid, newVs.toFixed(4), overall.toFixed(4)]
    );

    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}

