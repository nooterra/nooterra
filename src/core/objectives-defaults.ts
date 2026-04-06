// src/core/objectives-defaults.ts
//
// Re-exports AR objectives from domain pack for backward compatibility.
// When domain #2 arrives, this file merges objectives from multiple packs.

export {
  DEFAULT_AR_OBJECTIVES,
  SUPPORTED_OBJECTIVE_CONSTRAINTS,
  createDefaultArObjectives,
} from '../domains/ar/objectives.js';
