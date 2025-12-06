/**
 * Router Module (NIP-0012)
 *
 * Pluggable routing abstraction for agent selection.
 * Supports legacy routing and new Coordination Graph routing.
 */

export * from "./types.js";
export * from "./factory.js";
export { LegacyRouter } from "./legacy-router.js";
export { CoordinationGraphRouter } from "./coordination-graph-router.js";
