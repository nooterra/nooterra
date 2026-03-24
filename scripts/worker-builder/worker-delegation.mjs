/**
 * Worker-to-Worker Delegation
 *
 * Allows workers to delegate sub-tasks to other workers during execution.
 * Enforces transitive trust attenuation — each delegation hop can only
 * narrow constraints, never widen them. Tracks a full execution tree
 * and produces an audit log for every delegation.
 */

import crypto from 'crypto';

const MAX_DELEGATION_DEPTH = 3;

// ---------------------------------------------------------------------------
// Internal state factory
// ---------------------------------------------------------------------------

function createState() {
  return {
    /** @type {Map<string, object>} grantId -> grant */
    grants: new Map(),
    /** @type {Map<string, object>} executionId -> execution node */
    executions: new Map(),
    /** @type {object[]} append-only audit entries */
    auditLog: [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

/**
 * Attenuate constraints from a parent grant to a child grant.
 * Each field can only become stricter, never looser.
 */
function attenuateConstraints(parentGrant, childRequest) {
  const parentMax = parentGrant.maxCost ?? Infinity;
  const childMax = childRequest.maxCost ?? Infinity;

  const parentDur = parentGrant.maxDuration ?? Infinity;
  const childDur = childRequest.maxDuration ?? Infinity;

  // Merge constraint objects — child inherits every parent constraint and
  // can only add more restrictive ones.
  const parentConstraints = parentGrant.constraints || {};
  const childConstraints = childRequest.constraints || {};
  const merged = { ...parentConstraints };
  for (const [key, value] of Object.entries(childConstraints)) {
    if (!(key in merged)) {
      merged[key] = value;
    }
    // For numeric constraints, take the smaller value
    if (typeof value === 'number' && typeof merged[key] === 'number') {
      merged[key] = Math.min(merged[key], value);
    }
    // For boolean constraints, true (restricted) wins
    if (typeof value === 'boolean' && typeof merged[key] === 'boolean') {
      merged[key] = merged[key] || value;
    }
    // For arrays, intersect
    if (Array.isArray(merged[key]) && Array.isArray(value)) {
      merged[key] = merged[key].filter(v => value.includes(v));
    }
  }

  return {
    maxCost: Math.min(parentMax, childMax),
    maxDuration: Math.min(parentDur, childDur),
    constraints: merged,
  };
}

/**
 * Walk up the execution tree and count depth.
 */
function getDepth(state, executionId) {
  let depth = 0;
  let current = state.executions.get(executionId);
  while (current && current.parentId) {
    depth++;
    current = state.executions.get(current.parentId);
  }
  return depth;
}

/**
 * Build the full tree rooted at executionId.
 */
function buildTree(state, executionId) {
  const node = state.executions.get(executionId);
  if (!node) return null;

  const children = [];
  for (const childId of node.delegations) {
    const childTree = buildTree(state, childId);
    if (childTree) children.push(childTree);
  }

  return {
    executionId: node.executionId,
    parentId: node.parentId,
    workerId: node.workerId,
    task: node.task,
    status: node.status,
    result: node.result,
    delegations: children,
  };
}

// ---------------------------------------------------------------------------
// Core engine
// ---------------------------------------------------------------------------

/**
 * Create a delegation engine.
 *
 * @param {object} options
 * @param {function} options.resolveWorker  (workerName) => worker | null
 *   Resolves a worker name to a worker object (id, charter, provider, …).
 * @param {function} options.executeWorker  (worker, task, constraints) => Promise<{success, response}>
 *   Actually runs a worker against a task. Typically delegates to
 *   runWorkerExecution from worker-daemon.mjs.
 * @param {number}   [options.maxDepth]  Override default depth limit.
 */
export function createDelegationEngine(options = {}) {
  const {
    resolveWorker,
    executeWorker,
    maxDepth = MAX_DELEGATION_DEPTH,
  } = options;

  if (typeof resolveWorker !== 'function') {
    throw new Error('createDelegationEngine requires options.resolveWorker');
  }
  if (typeof executeWorker !== 'function') {
    throw new Error('createDelegationEngine requires options.executeWorker');
  }

  const state = createState();

  // -------------------------------------------------------------------
  // Grant creation
  // -------------------------------------------------------------------

  function createGrant(fromWorkerId, toWorkerId, task, opts = {}) {
    const grantId = `grant_${uid()}`;
    const createdAt = now();
    const expiresAt = opts.expiresAt || new Date(Date.now() + 3600_000).toISOString();

    const grant = {
      grantId,
      fromWorkerId,
      toWorkerId,
      task,
      constraints: opts.constraints || {},
      maxCost: opts.maxCost ?? Infinity,
      maxDuration: opts.maxDuration ?? Infinity,
      createdAt,
      expiresAt,
    };

    state.grants.set(grantId, grant);
    return grant;
  }

  // -------------------------------------------------------------------
  // Execution node management
  // -------------------------------------------------------------------

  function createExecution(workerId, task, parentId) {
    const executionId = `exec_${uid()}`;
    const node = {
      executionId,
      parentId: parentId || null,
      workerId,
      task,
      status: 'pending',
      result: null,
      delegations: [],
    };
    state.executions.set(executionId, node);

    // Register as child of parent
    if (parentId) {
      const parent = state.executions.get(parentId);
      if (parent) {
        parent.delegations.push(executionId);
      }
    }

    return node;
  }

  // -------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------

  function addAuditEntry(grant, outcome, startedAt, completedAt) {
    state.auditLog.push({
      grantId: grant.grantId,
      from: grant.fromWorkerId,
      to: grant.toWorkerId,
      task: grant.task,
      constraints: grant.constraints,
      maxCost: grant.maxCost,
      maxDuration: grant.maxDuration,
      outcome,
      startedAt,
      completedAt,
    });
  }

  // -------------------------------------------------------------------
  // delegate — the main entry point
  // -------------------------------------------------------------------

  async function delegate(fromWorker, toWorkerName, task, constraints = {}, _parentExecutionId = null) {
    const delegationStart = now();

    // Resolve target worker
    const toWorker = resolveWorker(toWorkerName);
    if (!toWorker) {
      const msg = `Delegation failed: worker "${toWorkerName}" not found`;
      return { success: false, error: msg };
    }

    // Depth check — find the current depth from the parent execution
    if (_parentExecutionId) {
      const depth = getDepth(state, _parentExecutionId);
      if (depth >= maxDepth) {
        const msg = `Delegation refused: max depth ${maxDepth} reached`;
        return { success: false, error: msg };
      }
    }

    // If there's a parent grant, attenuate constraints
    let effectiveMaxCost = constraints.maxCost ?? Infinity;
    let effectiveMaxDuration = constraints.maxDuration ?? Infinity;
    let effectiveConstraints = constraints;

    if (_parentExecutionId) {
      // Find the grant that spawned the parent execution
      const parentExec = state.executions.get(_parentExecutionId);
      if (parentExec) {
        const parentGrant = findGrantForExecution(parentExec);
        if (parentGrant) {
          const attenuated = attenuateConstraints(parentGrant, {
            maxCost: constraints.maxCost,
            maxDuration: constraints.maxDuration,
            constraints: constraints,
          });
          effectiveMaxCost = attenuated.maxCost;
          effectiveMaxDuration = attenuated.maxDuration;
          effectiveConstraints = attenuated.constraints;
        }
      }
    }

    // Create grant
    const fromId = typeof fromWorker === 'string' ? fromWorker : fromWorker.id;
    const toId = toWorker.id;
    const grant = createGrant(fromId, toId, task, {
      constraints: effectiveConstraints,
      maxCost: effectiveMaxCost,
      maxDuration: effectiveMaxDuration,
    });

    // Check expiry
    if (new Date(grant.expiresAt) <= new Date()) {
      addAuditEntry(grant, 'expired', delegationStart, now());
      return { success: false, error: 'Grant expired before execution' };
    }

    // Create execution node
    const execution = createExecution(toId, task, _parentExecutionId);
    execution.status = 'running';
    execution._grantId = grant.grantId;

    // Build a constrained execute function that sub-delegates can call
    const childDelegate = (childWorkerName, childTask, childConstraints = {}) => {
      return delegate(toWorker, childWorkerName, childTask, childConstraints, execution.executionId);
    };

    // Set up timeout
    let timedOut = false;
    let timeoutHandle = null;
    const durationMs = effectiveMaxDuration !== Infinity ? effectiveMaxDuration : null;

    const executionPromise = (async () => {
      try {
        const result = await executeWorker(toWorker, task, {
          ...effectiveConstraints,
          maxCost: effectiveMaxCost,
          maxDuration: effectiveMaxDuration,
          _delegationEngine: { delegate: childDelegate },
        });
        return result;
      } catch (err) {
        return { success: false, error: err.message };
      }
    })();

    let result;
    if (durationMs) {
      const timeoutPromise = new Promise((resolve) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          resolve({ success: false, error: `Delegation timed out after ${durationMs}ms` });
        }, durationMs);
      });
      result = await Promise.race([executionPromise, timeoutPromise]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
    } else {
      result = await executionPromise;
    }

    // Update execution node
    const completedAt = now();
    execution.status = timedOut ? 'timed_out' : (result.success ? 'completed' : 'failed');
    execution.result = result;

    // Audit
    const outcome = timedOut ? 'timed_out' : (result.success ? 'success' : 'failure');
    addAuditEntry(grant, outcome, delegationStart, completedAt);

    return {
      success: result.success !== false,
      executionId: execution.executionId,
      grantId: grant.grantId,
      result: result.response ?? result,
      error: result.error || null,
    };
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  function findGrantForExecution(execNode) {
    if (execNode._grantId) {
      return state.grants.get(execNode._grantId) || null;
    }
    return null;
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  function getDelegationTree(executionId) {
    return buildTree(state, executionId);
  }

  function getAuditLog(workerId) {
    if (!workerId) return [...state.auditLog];
    return state.auditLog.filter(
      entry => entry.from === workerId || entry.to === workerId
    );
  }

  return {
    delegate,
    getDelegationTree,
    getAuditLog,
    // Exposed for testing
    _state: state,
  };
}

// ---------------------------------------------------------------------------
// Tool builder — produces a tool definition the daemon injects into workers
// ---------------------------------------------------------------------------

/**
 * Build the __delegate_to_worker tool definition for use during execution.
 *
 * @param {object} engine  The delegation engine instance.
 * @param {object} currentWorker  The worker that is currently executing.
 * @param {string} [parentExecutionId]  The current execution's ID (for depth tracking).
 * @returns {object}  { definition, handler }
 *   definition — the tool schema to pass to the LLM
 *   handler(args) — call when the LLM invokes this tool
 */
export function buildDelegationTool(engine, currentWorker, parentExecutionId) {
  const definition = {
    name: '__delegate_to_worker',
    description:
      'Delegate a sub-task to another worker. The target worker will execute the task ' +
      'within your constraints and return the result. Use this when a task is better ' +
      'handled by a specialist worker.',
    parameters: {
      type: 'object',
      properties: {
        workerName: {
          type: 'string',
          description: 'Name of the worker to delegate to',
        },
        task: {
          type: 'string',
          description: 'Description of the task to delegate',
        },
        constraints: {
          type: 'object',
          description: 'Optional constraints (maxCost, maxDuration, etc.)',
          properties: {
            maxCost: { type: 'number', description: 'Maximum cost in USD' },
            maxDuration: { type: 'number', description: 'Maximum duration in milliseconds' },
          },
        },
      },
      required: ['workerName', 'task'],
    },
  };

  async function handler(args) {
    const { workerName, task, constraints = {} } = args;
    const result = await engine.delegate(
      currentWorker,
      workerName,
      task,
      constraints,
      parentExecutionId || null
    );
    if (!result.success) {
      return `Delegation to "${workerName}" failed: ${result.error}`;
    }
    return typeof result.result === 'string'
      ? result.result
      : JSON.stringify(result.result);
  }

  return { definition, handler };
}

export default {
  createDelegationEngine,
  buildDelegationTool,
};
