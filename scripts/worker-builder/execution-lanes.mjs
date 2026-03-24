/**
 * Execution Lanes
 *
 * Parallel execution lane system for workers running multiple subtasks.
 * Splits a complex task into independent lanes with isolated state,
 * runs them concurrently (up to a configurable limit), supports DAG
 * dependencies, partial recovery, and result merging.
 */

import { EventEmitter } from 'events';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_CONCURRENCY = 3;

/**
 * Lane status constants
 */
export const LANE_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  STALLED: 'stalled',
};

/**
 * Create a fresh lane object.
 */
function makeLane(id, task, options = {}) {
  return {
    laneId: id,
    task,
    status: LANE_STATUS.PENDING,
    messages: [],
    toolResults: [],
    result: null,
    startedAt: null,
    completedAt: null,
    error: null,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    meta: options.meta ?? {},
  };
}

/**
 * LaneManager
 *
 * Manages a set of execution lanes, their dependency graph, concurrent
 * execution, progress tracking, and result merging.
 */
class LaneManager extends EventEmitter {
  constructor(options = {}) {
    super();
    /** @type {Map<string, object>} */
    this._lanes = new Map();
    /** @type {Map<string, Set<string>>} laneId -> Set of laneIds it depends on */
    this._deps = new Map();
    this._concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this._counter = 0;
    this._executed = false;
  }

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  /**
   * Add a lane to the manager.
   * @param {string} task - Description / payload for this lane.
   * @param {object} [options] - { timeoutMs, meta }
   * @returns {string} The assigned laneId.
   */
  addLane(task, options = {}) {
    const id = options.laneId ?? `lane_${++this._counter}`;
    if (this._lanes.has(id)) {
      throw new Error(`Lane "${id}" already exists`);
    }
    this._lanes.set(id, makeLane(id, task, options));
    this._deps.set(id, new Set());
    return id;
  }

  /**
   * Declare that `laneId` depends on `dependsOnLaneId`.
   * `laneId` will not start until `dependsOnLaneId` completes successfully.
   */
  addDependency(laneId, dependsOnLaneId) {
    if (!this._lanes.has(laneId)) {
      throw new Error(`Lane "${laneId}" does not exist`);
    }
    if (!this._lanes.has(dependsOnLaneId)) {
      throw new Error(`Dependency lane "${dependsOnLaneId}" does not exist`);
    }
    if (laneId === dependsOnLaneId) {
      throw new Error('A lane cannot depend on itself');
    }
    this._deps.get(laneId).add(dependsOnLaneId);

    // Cycle detection (DFS from dependsOnLaneId back to laneId)
    if (this._hasCycle(laneId)) {
      this._deps.get(laneId).delete(dependsOnLaneId);
      throw new Error(`Adding dependency "${laneId}" -> "${dependsOnLaneId}" would create a cycle`);
    }
  }

  // -----------------------------------------------------------------------
  // Execution
  // -----------------------------------------------------------------------

  /**
   * Execute all lanes. `executeFn(lane, depResults)` is called for each lane
   * and should return the lane's result (or throw).
   *
   * depResults is a Map<string, any> of completed dependency lane results.
   *
   * @param {Function} executeFn
   * @returns {Promise<object>} Merged results.
   */
  async execute(executeFn) {
    if (typeof executeFn !== 'function') {
      throw new Error('executeFn must be a function');
    }
    if (this._lanes.size === 0) {
      throw new Error('No lanes to execute');
    }

    this._executed = true;

    // Track completed lanes for dependency resolution
    const completedResults = new Map();
    const remaining = new Set(
      [...this._lanes.keys()].filter(id => {
        const s = this._lanes.get(id).status;
        return s === LANE_STATUS.PENDING || s === LANE_STATUS.FAILED;
      })
    );

    // Already-completed lanes (from a previous run) seed the results map
    for (const [id, lane] of this._lanes) {
      if (lane.status === LANE_STATUS.COMPLETED) {
        completedResults.set(id, lane.result);
      }
    }

    await this._runWaves(executeFn, remaining, completedResults);

    this.emit('all:complete', this.getResults());
    return this.getResults();
  }

  /**
   * Retry only failed lanes.
   * @param {Function} executeFn
   * @returns {Promise<object>}
   */
  async retryFailed(executeFn) {
    if (typeof executeFn !== 'function') {
      throw new Error('executeFn must be a function');
    }

    // Reset failed lanes to pending
    for (const [, lane] of this._lanes) {
      if (lane.status === LANE_STATUS.FAILED) {
        lane.status = LANE_STATUS.PENDING;
        lane.error = null;
        lane.result = null;
        lane.messages = [];
        lane.toolResults = [];
        lane.startedAt = null;
        lane.completedAt = null;
      }
    }

    return this.execute(executeFn);
  }

  // -----------------------------------------------------------------------
  // Progress & Results
  // -----------------------------------------------------------------------

  /**
   * Get progress snapshot.
   */
  getProgress() {
    let total = 0, completed = 0, failed = 0, running = 0, pending = 0, stalled = 0;
    for (const [, lane] of this._lanes) {
      total++;
      switch (lane.status) {
        case LANE_STATUS.COMPLETED: completed++; break;
        case LANE_STATUS.FAILED:    failed++;    break;
        case LANE_STATUS.RUNNING:   running++;   break;
        case LANE_STATUS.STALLED:   stalled++;   break;
        default:                    pending++;   break;
      }
    }
    return {
      total,
      completed,
      failed,
      running,
      pending,
      stalled,
      percentComplete: total === 0 ? 0 : Math.round((completed / total) * 100),
    };
  }

  /**
   * Get all lane results merged into a unified response.
   */
  getResults() {
    const lanes = [];
    for (const [, lane] of this._lanes) {
      lanes.push({
        laneId: lane.laneId,
        task: lane.task,
        status: lane.status,
        result: lane.result,
        error: lane.error ? String(lane.error) : null,
        startedAt: lane.startedAt,
        completedAt: lane.completedAt,
        meta: lane.meta,
      });
    }

    // Build human-readable merged summary
    const parts = lanes.map(l => {
      const label = l.meta.label ?? l.laneId;
      if (l.status === LANE_STATUS.COMPLETED) {
        return `${label} (${l.task}): ${summarizeResult(l.result)}`;
      }
      if (l.status === LANE_STATUS.FAILED) {
        return `${label} (${l.task}): FAILED — ${l.error}`;
      }
      return `${label} (${l.task}): ${l.status}`;
    });

    return { lanes, merged: parts.join('\n') };
  }

  /**
   * Get a single lane by id.
   */
  getLane(laneId) {
    return this._lanes.get(laneId) ?? null;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /**
   * Run lanes in topological waves, respecting concurrency and deps.
   */
  async _runWaves(executeFn, remaining, completedResults) {
    while (remaining.size > 0) {
      // Find lanes whose deps are all satisfied
      const ready = [];
      for (const id of remaining) {
        const deps = this._deps.get(id);
        const allMet = [...deps].every(d => completedResults.has(d));
        if (allMet) ready.push(id);
      }

      if (ready.length === 0) {
        // Everything remaining is blocked by failed deps — mark stalled
        for (const id of remaining) {
          const lane = this._lanes.get(id);
          lane.status = LANE_STATUS.STALLED;
          lane.error = 'Blocked by failed or incomplete dependency';
          this.emit('lane:fail', lane);
        }
        break;
      }

      // Run ready lanes in batches of _concurrency
      const batches = chunk(ready, this._concurrency);
      for (const batch of batches) {
        const promises = batch.map(id => this._executeLane(id, executeFn, completedResults));
        const results = await Promise.allSettled(promises);

        for (let i = 0; i < batch.length; i++) {
          const id = batch[i];
          const lane = this._lanes.get(id);
          remaining.delete(id);

          if (results[i].status === 'fulfilled') {
            completedResults.set(id, lane.result);
          }
          // Failed lanes are already marked inside _executeLane
        }

        this.emit('lane:progress', this.getProgress());
      }
    }
  }

  /**
   * Execute a single lane with timeout.
   */
  async _executeLane(laneId, executeFn, completedResults) {
    const lane = this._lanes.get(laneId);
    lane.status = LANE_STATUS.RUNNING;
    lane.startedAt = new Date().toISOString();
    this.emit('lane:start', lane);

    // Build dep results map for this lane
    const depResults = new Map();
    for (const depId of this._deps.get(laneId)) {
      depResults.set(depId, completedResults.get(depId));
    }

    try {
      const result = await withTimeout(
        executeFn(lane, depResults),
        lane.timeoutMs,
        `Lane "${laneId}" timed out after ${lane.timeoutMs}ms`
      );
      lane.result = result;
      lane.status = LANE_STATUS.COMPLETED;
      lane.completedAt = new Date().toISOString();
      this.emit('lane:complete', lane);
      return result;
    } catch (err) {
      lane.status = LANE_STATUS.FAILED;
      lane.error = err;
      lane.completedAt = new Date().toISOString();
      this.emit('lane:fail', lane);
      throw err;
    }
  }

  /**
   * DFS cycle detection starting from `startId`.
   */
  _hasCycle(startId) {
    const visited = new Set();
    const stack = [startId];
    while (stack.length > 0) {
      const current = stack.pop();
      const deps = this._deps.get(current);
      if (!deps) continue;
      for (const dep of deps) {
        if (dep === startId && current !== startId) return true;
        if (dep === startId) continue; // self-ref already handled above
        if (!visited.has(dep)) {
          visited.add(dep);
          stack.push(dep);
        }
      }
    }
    // More robust: check if startId is reachable from startId via deps
    const reachable = new Set();
    const q = [...(this._deps.get(startId) || [])];
    while (q.length > 0) {
      const node = q.pop();
      if (node === startId) return true;
      if (reachable.has(node)) continue;
      reachable.add(node);
      for (const d of (this._deps.get(node) || [])) {
        q.push(d);
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Race a promise against a timeout.
 */
function withTimeout(promise, ms, message) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

/**
 * Split an array into chunks of size n.
 */
function chunk(arr, n) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += n) {
    chunks.push(arr.slice(i, i + n));
  }
  return chunks;
}

/**
 * Best-effort summarize a result value into a short string.
 */
function summarizeResult(value) {
  if (value === null || value === undefined) return '(no result)';
  if (typeof value === 'string') return value.length > 200 ? value.slice(0, 200) + '...' : value;
  if (typeof value === 'object') {
    try {
      const json = JSON.stringify(value);
      return json.length > 200 ? json.slice(0, 200) + '...' : json;
    } catch {
      return String(value);
    }
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a lane manager.
 * @param {object} [options] - { concurrency }
 * @returns {LaneManager}
 */
export function createLaneManager(options = {}) {
  return new LaneManager(options);
}

/**
 * Convenience: create a lane manager pre-populated with lanes from subtasks.
 * @param {string} parentTask - High-level task description.
 * @param {Array<{task: string, label?: string, timeoutMs?: number}>} subtasks
 * @param {object} [options]
 * @returns {LaneManager}
 */
export function createLanes(parentTask, subtasks, options = {}) {
  const manager = new LaneManager({ ...options, parentTask });
  for (const sub of subtasks) {
    manager.addLane(sub.task, {
      timeoutMs: sub.timeoutMs,
      meta: { label: sub.label ?? sub.task, parentTask },
    });
  }
  return manager;
}

export default {
  createLaneManager,
  createLanes,
  LANE_STATUS,
};
