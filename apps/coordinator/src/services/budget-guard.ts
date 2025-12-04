/**
 * Budget Guard Service
 * 
 * Pre-dispatch budget enforcement to prevent workflows from exceeding their budget.
 * Implements Q22-Q28, Q902 from protocol design.
 * 
 * Responsibilities:
 * 1. Check if adding a node's cost would exceed workflow max_cents
 * 2. Lock budget for node execution (prevent race conditions)
 * 3. Release budget on failure/refund
 * 4. Track spent_cents in real-time
 */

import { pool } from "../db.js";
import { recordBudgetReserved, recordBudgetConsumed, recordBudgetReleased } from "./metrics.js";

/**
 * Result of budget check
 */
export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  availableBudget?: number;
  requiredBudget?: number;
  spentSoFar?: number;
  maxBudget?: number;
}

/**
 * Log with service prefix
 */
function log(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) {
  const entry = {
    level,
    service: "budget-guard",
    msg,
    ...data,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(entry));
}

/**
 * Check if a node can be dispatched within the workflow budget
 * 
 * @param workflowId - The workflow ID
 * @param nodeName - The node being dispatched
 * @param capabilityId - The capability being invoked
 * @param bidAmount - Optional bid amount (if from auction)
 * @returns BudgetCheckResult with allowed status and details
 */
export async function checkBudget(
  workflowId: string,
  nodeName: string,
  capabilityId: string,
  bidAmount?: number
): Promise<BudgetCheckResult> {
  try {
    // Get workflow budget info
    const wfRes = await pool.query(
      `SELECT max_cents, spent_cents, status FROM workflows WHERE id = $1`,
      [workflowId]
    );

    if (!wfRes.rowCount) {
      return {
        allowed: false,
        reason: "workflow_not_found",
      };
    }

    const workflow = wfRes.rows[0];
    const maxCents = workflow.max_cents !== null ? Number(workflow.max_cents) : null;
    const spentCents = Number(workflow.spent_cents || 0);

    // If no budget limit set, allow all
    if (maxCents === null) {
      log("info", "No budget limit, allowing", { workflowId, nodeName });
      return { allowed: true, spentSoFar: spentCents };
    }

    // Get capability price (bid amount or registered price)
    let priceCents: number;
    
    if (bidAmount !== undefined) {
      priceCents = bidAmount;
    } else {
      const capRes = await pool.query(
        `SELECT price_cents FROM capabilities WHERE capability_id = $1 LIMIT 1`,
        [capabilityId]
      );
      priceCents = capRes.rowCount ? Number(capRes.rows[0].price_cents || 0) : 0;
    }

    // Calculate available budget
    const availableBudget = maxCents - spentCents;
    
    // Check if we would exceed
    if (priceCents > availableBudget) {
      log("warn", "Budget would be exceeded", {
        workflowId,
        nodeName,
        capabilityId,
        priceCents,
        availableBudget,
        spentCents,
        maxCents,
      });

      return {
        allowed: false,
        reason: "budget_exceeded",
        availableBudget,
        requiredBudget: priceCents,
        spentSoFar: spentCents,
        maxBudget: maxCents,
      };
    }

    log("info", "Budget check passed", {
      workflowId,
      nodeName,
      priceCents,
      availableBudget,
    });

    return {
      allowed: true,
      availableBudget,
      requiredBudget: priceCents,
      spentSoFar: spentCents,
      maxBudget: maxCents,
    };
  } catch (err: any) {
    log("error", "Budget check failed", { workflowId, nodeName, error: err.message });
    return {
      allowed: false,
      reason: `budget_check_error: ${err.message}`,
    };
  }
}

/**
 * Reserve budget for a node (atomic lock to prevent race conditions)
 * 
 * @param workflowId - The workflow ID
 * @param nodeName - The node being dispatched
 * @param amountCents - Amount to reserve
 * @returns true if reservation successful, false otherwise
 */
export async function reserveBudget(
  workflowId: string,
  nodeName: string,
  amountCents: number
): Promise<boolean> {
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");

    // Lock the workflow row
    const wfRes = await client.query(
      `SELECT max_cents, spent_cents FROM workflows WHERE id = $1 FOR UPDATE`,
      [workflowId]
    );

    if (!wfRes.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }

    const workflow = wfRes.rows[0];
    const maxCents = workflow.max_cents !== null ? Number(workflow.max_cents) : null;
    const spentCents = Number(workflow.spent_cents || 0);

    // Check if reservation is possible
    if (maxCents !== null && spentCents + amountCents > maxCents) {
      await client.query("ROLLBACK");
      log("warn", "Budget reservation failed - would exceed", {
        workflowId,
        nodeName,
        amountCents,
        spentCents,
        maxCents,
      });
      return false;
    }

    // Update spent_cents (reserve the budget)
    await client.query(
      `UPDATE workflows SET spent_cents = spent_cents + $1, updated_at = NOW()
       WHERE id = $2`,
      [amountCents, workflowId]
    );

    // Record the reservation in a tracking table (for potential rollback)
    await client.query(
      `INSERT INTO budget_reservations (workflow_id, node_name, amount_cents, status)
       VALUES ($1, $2, $3, 'reserved')
       ON CONFLICT (workflow_id, node_name) 
       DO UPDATE SET amount_cents = $3, status = 'reserved', updated_at = NOW()`,
      [workflowId, nodeName, amountCents]
    );

    await client.query("COMMIT");

    log("info", "Budget reserved", { workflowId, nodeName, amountCents });
    recordBudgetReserved(amountCents);
    return true;
  } catch (err: any) {
    await client.query("ROLLBACK");
    log("error", "Budget reservation error", { workflowId, nodeName, error: err.message });
    return false;
  } finally {
    client.release();
  }
}

/**
 * Release reserved budget (on failure/refund)
 * 
 * @param workflowId - The workflow ID
 * @param nodeName - The node that failed
 * @returns true if release successful
 */
export async function releaseBudget(
  workflowId: string,
  nodeName: string
): Promise<boolean> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Get the reservation
    const resRes = await client.query(
      `SELECT amount_cents FROM budget_reservations 
       WHERE workflow_id = $1 AND node_name = $2 AND status = 'reserved'
       FOR UPDATE`,
      [workflowId, nodeName]
    );

    if (!resRes.rowCount) {
      await client.query("ROLLBACK");
      log("warn", "No budget reservation found to release", { workflowId, nodeName });
      return false;
    }

    const amountCents = Number(resRes.rows[0].amount_cents);

    // Decrement spent_cents
    await client.query(
      `UPDATE workflows SET spent_cents = GREATEST(0, spent_cents - $1), updated_at = NOW()
       WHERE id = $2`,
      [amountCents, workflowId]
    );

    // Mark reservation as released
    await client.query(
      `UPDATE budget_reservations SET status = 'released', updated_at = NOW()
       WHERE workflow_id = $1 AND node_name = $2`,
      [workflowId, nodeName]
    );

    await client.query("COMMIT");

    log("info", "Budget released", { workflowId, nodeName, amountCents });
    recordBudgetReleased("refund", amountCents);
    return true;
  } catch (err: any) {
    await client.query("ROLLBACK");
    log("error", "Budget release error", { workflowId, nodeName, error: err.message });
    return false;
  } finally {
    client.release();
  }
}

/**
 * Confirm budget consumption (on success)
 * Marks the reservation as consumed so it won't be released
 * 
 * @param workflowId - The workflow ID
 * @param nodeName - The node that succeeded
 */
export async function confirmBudget(
  workflowId: string,
  nodeName: string,
  capabilityId?: string
): Promise<void> {
  try {
    // Get the amount that was reserved
    const resRes = await pool.query(
      `SELECT amount_cents FROM budget_reservations 
       WHERE workflow_id = $1 AND node_name = $2`,
      [workflowId, nodeName]
    );
    const amountCents = resRes.rows[0]?.amount_cents || 0;

    await pool.query(
      `UPDATE budget_reservations SET status = 'consumed', updated_at = NOW()
       WHERE workflow_id = $1 AND node_name = $2`,
      [workflowId, nodeName]
    );
    
    log("info", "Budget consumption confirmed", { workflowId, nodeName });
    
    if (amountCents > 0) {
      recordBudgetConsumed(capabilityId || "unknown", amountCents);
    }
  } catch (err: any) {
    log("error", "Budget confirmation error", { workflowId, nodeName, error: err.message });
  }
}

/**
 * Get workflow budget summary
 */
export async function getBudgetSummary(workflowId: string): Promise<{
  maxCents: number | null;
  spentCents: number;
  availableCents: number | null;
  reservedCents: number;
} | null> {
  try {
    const wfRes = await pool.query(
      `SELECT max_cents, spent_cents FROM workflows WHERE id = $1`,
      [workflowId]
    );

    if (!wfRes.rowCount) return null;

    const workflow = wfRes.rows[0];
    const maxCents = workflow.max_cents !== null ? Number(workflow.max_cents) : null;
    const spentCents = Number(workflow.spent_cents || 0);

    // Get active reservations
    const resRes = await pool.query(
      `SELECT COALESCE(SUM(amount_cents), 0) as reserved 
       FROM budget_reservations 
       WHERE workflow_id = $1 AND status = 'reserved'`,
      [workflowId]
    );
    const reservedCents = Number(resRes.rows[0]?.reserved || 0);

    return {
      maxCents,
      spentCents,
      availableCents: maxCents !== null ? maxCents - spentCents : null,
      reservedCents,
    };
  } catch (err: any) {
    log("error", "Get budget summary error", { workflowId, error: err.message });
    return null;
  }
}
