/**
 * Worker Persistence
 * 
 * Save and load workers to/from disk.
 * Workers are stored in ~/.nooterra/workers/
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const WORKERS_DIR = path.join(os.homedir(), '.nooterra', 'workers');

/**
 * Worker status
 */
export const WORKER_STATUS = {
  DRAFT: 'draft',           // Being created
  READY: 'ready',           // Ready to run
  RUNNING: 'running',       // Currently executing
  PAUSED: 'paused',         // Temporarily stopped
  ERROR: 'error',           // Has errors
  ARCHIVED: 'archived'      // No longer active
};

/**
 * Ensure workers directory exists
 */
function ensureDir() {
  if (!fs.existsSync(WORKERS_DIR)) {
    fs.mkdirSync(WORKERS_DIR, { recursive: true });
  }
}

/**
 * Generate worker ID
 */
export function generateWorkerId(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  const timestamp = Date.now().toString(36);
  return `wrk_${slug}_${timestamp}`;
}

/**
 * Get worker file path
 */
function getWorkerPath(workerId) {
  return path.join(WORKERS_DIR, `${workerId}.json`);
}

/**
 * Create a new worker
 */
export function createWorker(charter, options = {}) {
  ensureDir();

  const workerId = generateWorkerId(charter.name);
  
  const worker = {
    id: workerId,
    version: 1,
    status: WORKER_STATUS.READY,
    charter,
    provider: options.provider || null,
    model: options.model || null,
    triggers: options.triggers || [],
    stats: {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      totalApprovals: 0,
      totalRejections: 0,
      totalSpent: 0
    },
    lastRun: null,
    nextRun: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  saveWorker(worker);
  return worker;
}

/**
 * Save a worker to disk
 */
export function saveWorker(worker) {
  ensureDir();
  
  worker.updatedAt = new Date().toISOString();
  worker.version = (worker.version || 0) + 1;
  
  const filePath = getWorkerPath(worker.id);
  fs.writeFileSync(filePath, JSON.stringify(worker, null, 2));
  
  return worker;
}

/**
 * Load a worker from disk
 */
export function loadWorker(workerId) {
  const filePath = getWorkerPath(workerId);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`Failed to load worker ${workerId}:`, err.message);
    return null;
  }
}

/**
 * Delete a worker
 */
export function deleteWorker(workerId) {
  const filePath = getWorkerPath(workerId);
  
  if (fs.existsSync(filePath)) {
    // Move to archived instead of deleting
    const worker = loadWorker(workerId);
    if (worker) {
      worker.status = WORKER_STATUS.ARCHIVED;
      worker.archivedAt = new Date().toISOString();
      saveWorker(worker);
    }
    return true;
  }
  return false;
}

/**
 * Permanently delete a worker
 */
export function permanentlyDeleteWorker(workerId) {
  const filePath = getWorkerPath(workerId);
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * List all workers
 */
export function listWorkers(options = {}) {
  ensureDir();
  
  const files = fs.readdirSync(WORKERS_DIR)
    .filter(f => f.startsWith('wrk_') && f.endsWith('.json'));
  
  const workers = [];
  
  for (const file of files) {
    try {
      const data = fs.readFileSync(path.join(WORKERS_DIR, file), 'utf8');
      const worker = JSON.parse(data);
      
      // Filter by status
      if (options.status && worker.status !== options.status) {
        continue;
      }
      
      // Filter out archived unless explicitly requested
      if (!options.includeArchived && worker.status === WORKER_STATUS.ARCHIVED) {
        continue;
      }
      
      workers.push(worker);
    } catch (err) {
      console.error(`Failed to load worker from ${file}:`, err.message);
    }
  }
  
  // Sort by most recently updated
  workers.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  
  return workers;
}

/**
 * Find worker by name
 */
export function findWorkerByName(name) {
  const workers = listWorkers();
  const normalizedName = name.toLowerCase();
  
  return workers.find(w => 
    w.charter.name.toLowerCase() === normalizedName ||
    w.id.includes(normalizedName)
  );
}

/**
 * Update worker status
 */
export function updateWorkerStatus(workerId, status) {
  const worker = loadWorker(workerId);
  if (!worker) return null;
  
  worker.status = status;
  return saveWorker(worker);
}

/**
 * Update worker charter
 */
export function updateWorkerCharter(workerId, charter) {
  const worker = loadWorker(workerId);
  if (!worker) return null;
  
  worker.charter = charter;
  return saveWorker(worker);
}

/**
 * Add trigger to worker
 */
export function addWorkerTrigger(workerId, trigger) {
  const worker = loadWorker(workerId);
  if (!worker) return null;
  
  worker.triggers = worker.triggers || [];
  worker.triggers.push({
    ...trigger,
    id: `trg_${Date.now().toString(36)}`,
    createdAt: new Date().toISOString()
  });
  
  return saveWorker(worker);
}

/**
 * Remove trigger from worker
 */
export function removeWorkerTrigger(workerId, triggerId) {
  const worker = loadWorker(workerId);
  if (!worker) return null;
  
  worker.triggers = (worker.triggers || []).filter(t => t.id !== triggerId);
  return saveWorker(worker);
}

/**
 * Record worker run
 */
export function recordWorkerRun(workerId, result) {
  const worker = loadWorker(workerId);
  if (!worker) return null;
  
  worker.stats.totalRuns++;
  
  if (result.success) {
    worker.stats.successfulRuns++;
  } else {
    worker.stats.failedRuns++;
  }
  
  if (result.approved) {
    worker.stats.totalApprovals++;
  }
  if (result.rejected) {
    worker.stats.totalRejections++;
  }
  if (result.spent) {
    worker.stats.totalSpent += result.spent;
  }
  
  worker.lastRun = {
    timestamp: new Date().toISOString(),
    success: result.success,
    taskId: result.taskId,
    duration: result.duration
  };
  
  return saveWorker(worker);
}

/**
 * Set next run time
 */
export function setWorkerNextRun(workerId, nextRunTime) {
  const worker = loadWorker(workerId);
  if (!worker) return null;
  
  worker.nextRun = nextRunTime ? nextRunTime.toISOString() : null;
  return saveWorker(worker);
}

/**
 * Get worker summary for display
 */
export function getWorkerSummary(worker) {
  if (!worker) return null;
  
  return {
    id: worker.id,
    name: worker.charter.name,
    status: worker.status,
    purpose: worker.charter.purpose,
    provider: worker.provider,
    model: worker.model,
    capabilities: worker.charter.capabilities?.map(c => c.name) || [],
    stats: worker.stats,
    lastRun: worker.lastRun?.timestamp,
    nextRun: worker.nextRun,
    createdAt: worker.createdAt
  };
}

/**
 * Get all worker summaries
 */
export function getAllWorkerSummaries() {
  const workers = listWorkers();
  return workers.map(getWorkerSummary);
}

/**
 * Export worker as portable JSON
 */
export function exportWorker(workerId) {
  const worker = loadWorker(workerId);
  if (!worker) return null;
  
  return {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    worker: {
      charter: worker.charter,
      triggers: worker.triggers,
      provider: worker.provider,
      model: worker.model
    }
  };
}

/**
 * Import worker from portable JSON
 */
export function importWorker(exportData) {
  if (!exportData?.worker?.charter) {
    throw new Error('Invalid export data');
  }
  
  const worker = createWorker(exportData.worker.charter, {
    provider: exportData.worker.provider,
    model: exportData.worker.model,
    triggers: exportData.worker.triggers
  });
  
  return worker;
}

/**
 * Get workers directory path
 */
export function getWorkersDir() {
  return WORKERS_DIR;
}

export default {
  WORKER_STATUS,
  generateWorkerId,
  createWorker,
  saveWorker,
  loadWorker,
  deleteWorker,
  permanentlyDeleteWorker,
  listWorkers,
  findWorkerByName,
  updateWorkerStatus,
  updateWorkerCharter,
  addWorkerTrigger,
  removeWorkerTrigger,
  recordWorkerRun,
  setWorkerNextRun,
  getWorkerSummary,
  getAllWorkerSummaries,
  exportWorker,
  importWorker,
  getWorkersDir
};
