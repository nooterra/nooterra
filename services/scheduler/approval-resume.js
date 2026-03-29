/**
 * Approval resume flow.
 *
 * When a worker execution is paused awaiting approval (status: 'awaiting_approval'),
 * and the user approves the action in the dashboard, this module resumes the
 * execution from where it left off.
 *
 * Flow:
 *   1. User approves action in dashboard (PATCH /v1/approvals/:id)
 *   2. worker_approvals.decision is updated to 'approved'
 *   3. Postgres trigger fires NOTIFY 'approval_decided'
 *   4. This module's listener picks it up and resumes the execution
 *   5. The paused tool call is executed and the agentic loop continues
 *
 * Can also be polled as a fallback if LISTEN/NOTIFY is not available.
 */

/**
 * Resume a worker execution that was paused awaiting approval.
 *
 * @param {object} opts
 * @param {object} opts.pool - Postgres connection pool
 * @param {string} opts.approvalId - The approval record ID
 * @param {Function} opts.executeWorker - The main worker execution function
 * @param {Function} opts.log - Logger function
 * @returns {Promise<{ resumed: boolean, executionId?: string, error?: string }>}
 */
export async function resumeAfterApproval({ pool, approvalId, executeWorker, log }) {
  const logFn = log ?? (() => {});

  // 1. Load the approval record
  const approvalResult = await pool.query(
    `SELECT id, worker_id, tenant_id, tool_name, tool_args, decision
     FROM worker_approvals WHERE id = $1`,
    [approvalId]
  );
  const approval = approvalResult.rows[0];
  if (!approval) {
    return { resumed: false, error: "approval not found" };
  }
  if (approval.decision !== "approved") {
    return { resumed: false, error: `approval decision is '${approval.decision}', not 'approved'` };
  }

  // 2. Find the paused execution
  const execResult = await pool.query(
    `SELECT id, worker_id, tenant_id, status, activity
     FROM worker_executions
     WHERE worker_id = $1 AND tenant_id = $2 AND status = 'awaiting_approval'
     ORDER BY started_at DESC LIMIT 1`,
    [approval.worker_id, approval.tenant_id]
  );
  const execution = execResult.rows[0];
  if (!execution) {
    logFn("warn", `No awaiting_approval execution found for worker ${approval.worker_id}`);
    return { resumed: false, error: "no paused execution found" };
  }

  // 3. Load the full worker
  const workerResult = await pool.query(
    `SELECT * FROM workers WHERE id = $1 AND tenant_id = $2`,
    [approval.worker_id, approval.tenant_id]
  );
  const worker = workerResult.rows[0];
  if (!worker) {
    return { resumed: false, error: "worker not found" };
  }

  // 4. Mark execution as running again
  await pool.query(
    `UPDATE worker_executions SET status = 'running' WHERE id = $1`,
    [execution.id]
  );

  // 5. Add the approved tool call to the execution context
  const approvedToolCall = {
    name: approval.tool_name,
    args: typeof approval.tool_args === "string"
      ? JSON.parse(approval.tool_args)
      : approval.tool_args ?? {}
  };

  logFn("info", `Resuming execution ${execution.id} after approval of ${approval.tool_name}`);

  // 6. Re-run the worker execution with the approved context
  // The executeWorker function will see the execution already exists
  // and pick up where it left off with the approved tool calls
  try {
    await executeWorker(worker, execution.id, "approval_resume", {
      approvedToolCalls: [approvedToolCall],
      approvalId: approval.id
    });

    return { resumed: true, executionId: execution.id };
  } catch (err) {
    logFn("error", `Failed to resume execution ${execution.id}: ${err?.message}`);
    return { resumed: false, executionId: execution.id, error: err?.message };
  }
}

/**
 * Poll for approved actions and resume their executions.
 * Fallback for when LISTEN/NOTIFY is not available.
 *
 * @param {object} opts
 * @param {object} opts.pool - Postgres connection pool
 * @param {Function} opts.executeWorker - The main worker execution function
 * @param {Function} opts.log - Logger function
 * @returns {Promise<number>} Number of executions resumed
 */
export async function pollApprovedActions({ pool, executeWorker, log }) {
  const logFn = log ?? (() => {});

  // Find recently approved actions that haven't been processed
  const result = await pool.query(
    `SELECT wa.id AS approval_id, wa.worker_id, wa.tenant_id
     FROM worker_approvals wa
     JOIN worker_executions we ON we.worker_id = wa.worker_id AND we.tenant_id = wa.tenant_id
     WHERE wa.decision = 'approved'
       AND wa.decided_at > NOW() - INTERVAL '1 hour'
       AND we.status = 'awaiting_approval'
     ORDER BY wa.decided_at ASC
     LIMIT 5`
  );

  let resumed = 0;
  for (const row of result.rows) {
    const { approval_id } = row;
    const res = await resumeAfterApproval({ pool, approvalId: approval_id, executeWorker, log: logFn });
    if (res.resumed) resumed++;
  }

  return resumed;
}

/**
 * Handle an approval decision from the API.
 * Called when user clicks Approve or Deny in the dashboard.
 *
 * @param {object} opts
 * @param {object} opts.pool - Postgres connection pool
 * @param {string} opts.approvalId - The approval record ID
 * @param {string} opts.decision - 'approved' or 'denied'
 * @param {string} opts.decidedBy - Who decided (userId, email, etc.)
 * @param {Function} opts.executeWorker - The main worker execution function (for auto-resume on approve)
 * @param {Function} opts.log - Logger function
 * @returns {Promise<{ ok: boolean, resumed?: boolean, error?: string }>}
 */
export async function handleApprovalDecision({ pool, approvalId, decision, decidedBy, executeWorker, log }) {
  const logFn = log ?? (() => {});

  if (!["approved", "denied"].includes(decision)) {
    return { ok: false, error: "decision must be 'approved' or 'denied'" };
  }

  // 1. Update the approval record
  const result = await pool.query(
    `UPDATE worker_approvals
     SET decision = $1, decided_by = $2, decided_at = NOW()
     WHERE id = $3 AND decision = 'pending'
     RETURNING id, worker_id, tenant_id, tool_name`,
    [decision, decidedBy, approvalId]
  );

  if (result.rows.length === 0) {
    return { ok: false, error: "approval not found or already decided" };
  }

  const approval = result.rows[0];
  logFn("info", `Approval ${approvalId} ${decision} by ${decidedBy} for tool ${approval.tool_name}`);

  // 2. If denied, mark the execution as charter_blocked
  if (decision === "denied") {
    await pool.query(
      `UPDATE worker_executions
       SET status = 'charter_blocked', completed_at = NOW(),
           error = $1
       WHERE worker_id = $2 AND tenant_id = $3 AND status = 'awaiting_approval'`,
      [
        `Action denied: ${approval.tool_name} was denied by ${decidedBy}`,
        approval.worker_id,
        approval.tenant_id
      ]
    );
    return { ok: true, resumed: false };
  }

  // 3. If approved, resume the execution
  const resumeResult = await resumeAfterApproval({
    pool,
    approvalId,
    executeWorker,
    log: logFn
  });

  return { ok: true, resumed: resumeResult.resumed, executionId: resumeResult.executionId };
}
