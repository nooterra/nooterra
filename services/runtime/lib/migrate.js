/**
 * Auto-migration runner for the agent runtime.
 * Runs all unapplied SQL migrations on startup with advisory locking.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCK_KEY = "nooterra:migrations:v1";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../src/db/migrations");

// Only run migrations 034+ (worker/runtime schema).
// Migrations 001-033 were for the old API and reference tables (jobs, contracts,
// deliveries, agents, sessions) that don't exist in the runtime database.
const MIN_MIGRATION = "034_";

// These migrations reference old-API tables that don't exist in the runtime DB.
const SKIP_MIGRATIONS = new Set([
  "035_outbox_listen_notify.sql",    // references outbox table
  "037_row_level_security.sql",      // references jobs, contracts, deliveries, agents, sessions
  "042_complete_rls.sql",            // references old-API tables
  "043_missing_indexes.sql",         // references old-API tables
]);

export async function runMigrations(pool, log) {
  const lockClient = await pool.connect();
  try {
    await lockClient.query("SELECT pg_advisory_lock(hashtext($1))", [LOCK_KEY]);

    await lockClient.query(`
      CREATE TABLE IF NOT EXISTS proxy_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set();
    const existing = await lockClient.query("SELECT id FROM proxy_migrations ORDER BY id ASC");
    for (const row of existing.rows) {
      if (row?.id) applied.add(String(row.id));
    }

    const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile() && e.name.endsWith(".sql") && e.name >= MIN_MIGRATION)
      .map(e => e.name)
      .sort();

    let count = 0;
    for (const filename of files) {
      if (applied.has(filename)) continue;
      if (SKIP_MIGRATIONS.has(filename)) continue;
      const full = path.join(MIGRATIONS_DIR, filename);
      const sql = await fs.readFile(full, "utf8");

      try {
        await lockClient.query("BEGIN");
        await lockClient.query(sql);
        await lockClient.query("INSERT INTO proxy_migrations (id) VALUES ($1)", [filename]);
        await lockClient.query("COMMIT");
        count++;
        log("info", `Migration applied: ${filename}`);
      } catch (err) {
        try { await lockClient.query("ROLLBACK"); } catch {}
        log("error", `Migration failed: ${filename}: ${err.message}`);
        throw err;
      }
    }

    if (count > 0) {
      log("info", `Migrations complete: ${count} applied, ${applied.size + count} total`);
    } else {
      log("info", `Migrations: all ${applied.size} already applied`);
    }
  } finally {
    try { await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_KEY]); } catch {}
    lockClient.release();
  }
}
