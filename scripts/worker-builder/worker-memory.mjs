/**
 * Worker Memory System
 * 
 * Persistent context across worker runs.
 * Workers can remember things between executions.
 */

import fs from 'fs';
import path from 'path';

/**
 * Memory Store - persistent key-value storage for workers
 */
export class WorkerMemory {
  constructor(workerId, options = {}) {
    this.workerId = workerId;
    this.dataDir = options.dataDir || path.join(process.env.HOME, '.nooterra', 'memory');
    this.memory = {};
    this.metadata = {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accessCount: 0
    };
    this.load();
  }

  /**
   * Get the file path for this worker's memory
   */
  getFilePath() {
    return path.join(this.dataDir, `${this.workerId}.json`);
  }

  /**
   * Load memory from disk
   */
  load() {
    const filePath = this.getFilePath();
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        this.memory = data.memory || {};
        this.metadata = data.metadata || this.metadata;
      }
    } catch (err) {
      console.error(`Failed to load memory for ${this.workerId}:`, err.message);
      this.memory = {};
    }
  }

  /**
   * Save memory to disk
   */
  save() {
    const filePath = this.getFilePath();
    
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.metadata.updatedAt = new Date().toISOString();

    fs.writeFileSync(filePath, JSON.stringify({
      workerId: this.workerId,
      memory: this.memory,
      metadata: this.metadata
    }, null, 2));
  }

  /**
   * Store a value
   */
  set(key, value, options = {}) {
    this.memory[key] = {
      value,
      type: typeof value,
      createdAt: this.memory[key]?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ttl: options.ttl || null,
      tags: options.tags || []
    };
    this.save();
    return true;
  }

  /**
   * Retrieve a value
   */
  get(key) {
    const entry = this.memory[key];
    if (!entry) return undefined;

    // Check TTL
    if (entry.ttl) {
      const expiresAt = new Date(entry.createdAt).getTime() + entry.ttl;
      if (Date.now() > expiresAt) {
        this.delete(key);
        return undefined;
      }
    }

    this.metadata.accessCount++;
    return entry.value;
  }

  /**
   * Check if key exists
   */
  has(key) {
    return this.get(key) !== undefined;
  }

  /**
   * Delete a key
   */
  delete(key) {
    if (this.memory[key]) {
      delete this.memory[key];
      this.save();
      return true;
    }
    return false;
  }

  /**
   * Get all keys
   */
  keys() {
    return Object.keys(this.memory);
  }

  /**
   * Get all entries
   */
  entries() {
    return Object.entries(this.memory).map(([key, entry]) => ({
      key,
      value: entry.value,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      tags: entry.tags
    }));
  }

  /**
   * Search by tags
   */
  findByTag(tag) {
    return this.entries().filter(entry => entry.tags.includes(tag));
  }

  /**
   * Search by value (simple text search)
   */
  search(query) {
    const q = query.toLowerCase();
    return this.entries().filter(entry => {
      const valueStr = JSON.stringify(entry.value).toLowerCase();
      return valueStr.includes(q);
    });
  }

  /**
   * Append to an array value
   */
  append(key, value) {
    const existing = this.get(key);
    if (Array.isArray(existing)) {
      this.set(key, [...existing, value]);
    } else if (existing === undefined) {
      this.set(key, [value]);
    } else {
      throw new Error(`Cannot append to non-array value at key: ${key}`);
    }
  }

  /**
   * Increment a numeric value
   */
  increment(key, amount = 1) {
    const existing = this.get(key);
    if (typeof existing === 'number') {
      this.set(key, existing + amount);
    } else if (existing === undefined) {
      this.set(key, amount);
    } else {
      throw new Error(`Cannot increment non-numeric value at key: ${key}`);
    }
    return this.get(key);
  }

  /**
   * Clear all memory
   */
  clear() {
    this.memory = {};
    this.save();
  }

  /**
   * Get memory stats
   */
  getStats() {
    return {
      workerId: this.workerId,
      keyCount: Object.keys(this.memory).length,
      ...this.metadata
    };
  }

  /**
   * Export memory as JSON
   */
  export() {
    return {
      workerId: this.workerId,
      exportedAt: new Date().toISOString(),
      memory: this.memory,
      metadata: this.metadata
    };
  }

  /**
   * Import memory from JSON
   */
  import(data) {
    if (data.workerId && data.workerId !== this.workerId) {
      console.warn(`Importing memory from different worker: ${data.workerId}`);
    }
    this.memory = data.memory || {};
    this.metadata = {
      ...this.metadata,
      importedFrom: data.workerId,
      importedAt: new Date().toISOString()
    };
    this.save();
  }
}

/**
 * Memory Manager - manages memory for all workers
 */
export class MemoryManager {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(process.env.HOME, '.nooterra', 'memory');
    this.instances = new Map();
  }

  /**
   * Get or create memory for a worker
   */
  getMemory(workerId) {
    if (!this.instances.has(workerId)) {
      this.instances.set(workerId, new WorkerMemory(workerId, { dataDir: this.dataDir }));
    }
    return this.instances.get(workerId);
  }

  /**
   * List all workers with memory
   */
  listWorkers() {
    if (!fs.existsSync(this.dataDir)) {
      return [];
    }

    return fs.readdirSync(this.dataDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  /**
   * Delete memory for a worker
   */
  deleteMemory(workerId) {
    const filePath = path.join(this.dataDir, `${workerId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      this.instances.delete(workerId);
      return true;
    }
    return false;
  }

  /**
   * Get total memory usage
   */
  getStorageStats() {
    if (!fs.existsSync(this.dataDir)) {
      return { workerCount: 0, totalBytes: 0 };
    }

    const files = fs.readdirSync(this.dataDir).filter(f => f.endsWith('.json'));
    let totalBytes = 0;

    for (const file of files) {
      const stat = fs.statSync(path.join(this.dataDir, file));
      totalBytes += stat.size;
    }

    return {
      workerCount: files.length,
      totalBytes,
      totalMB: (totalBytes / (1024 * 1024)).toFixed(2)
    };
  }
}

// Singleton instance
let managerInstance = null;

/**
 * Get or create the memory manager instance
 */
export function getMemoryManager(options) {
  if (!managerInstance) {
    managerInstance = new MemoryManager(options);
  }
  return managerInstance;
}

/**
 * Quick helper to get memory for a worker
 */
export function getWorkerMemory(workerId) {
  return getMemoryManager().getMemory(workerId);
}

export default {
  WorkerMemory,
  MemoryManager,
  getMemoryManager,
  getWorkerMemory
};
