import { pool } from "../db.js";

const HALF_LIFE_HOURS = Number(process.env.REP_HALF_LIFE_HOURS || 72);
const LN2 = Math.log(2);

function decayFactor(lastUpdated: Date | null): number {
  if (!lastUpdated) return 1;
  const deltaHours = (Date.now() - lastUpdated.getTime()) / 3_600_000;
  if (deltaHours <= 0) return 1;
  const lambda = LN2 / Math.max(1, HALF_LIFE_HOURS);
  return Math.exp(-lambda * deltaHours);
}

export async function recordReputationEvent(params: {
  agentDid: string;
  outcome: "success" | "failure";
  latencyMs?: number;
  dispute?: boolean;
}) {
  const { agentDid, outcome, latencyMs, dispute } = params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `select total_tasks, successes, failures, disputes, p90_latency_ms, last_event_at
         from agent_reputation_stats
        where agent_did = $1
        for update`,
      [agentDid]
    );
    const row = res.rowCount ? res.rows[0] : null;
    const df = decayFactor(row?.last_event_at || null);

    const total = (Number(row?.total_tasks || 0) * df) + 1;
    const successes = (Number(row?.successes || 0) * df) + (outcome === "success" ? 1 : 0);
    const failures = (Number(row?.failures || 0) * df) + (outcome === "failure" ? 1 : 0);
    const disputesCount = (Number(row?.disputes || 0) * df) + (dispute ? 1 : 0);

    let p90 = row?.p90_latency_ms != null ? Number(row.p90_latency_ms) : null;
    if (typeof latencyMs === "number") {
      p90 = p90 == null ? latencyMs : Math.round(0.2 * latencyMs + 0.8 * p90);
    }

    if (row) {
      await client.query(
        `update agent_reputation_stats
            set total_tasks = $2,
                successes = $3,
                failures = $4,
                disputes = $5,
                p90_latency_ms = $6,
                last_event_at = now(),
                updated_at = now()
          where agent_did = $1`,
        [agentDid, total, successes, failures, disputesCount, p90]
      );
    } else {
      await client.query(
        `insert into agent_reputation_stats
           (agent_did, total_tasks, successes, failures, disputes, p90_latency_ms, last_event_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, now(), now())`,
        [agentDid, total, successes, failures, disputesCount, p90]
      );
    }
    await client.query("COMMIT");
    return { total, successes, failures, disputes: disputesCount, p90_latency_ms: p90 };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getReputation(agentDid: string) {
  const res = await pool.query(
    `select total_tasks, successes, failures, disputes, p90_latency_ms, updated_at
       from agent_reputation_stats
      where agent_did = $1`,
    [agentDid]
  );
  if (!res.rowCount) return null;
  const row = res.rows[0];
  const total = Number(row.total_tasks || 0);
  const successes = Number(row.successes || 0);
  const failures = Number(row.failures || 0);
  const disputes = Number(row.disputes || 0);
  const successRate = total > 0 ? successes / total : 0;
  return {
    total,
    successes,
    failures,
    disputes,
    successRate,
    p90_latency_ms: row.p90_latency_ms != null ? Number(row.p90_latency_ms) : null,
    updated_at: row.updated_at,
  };
}
