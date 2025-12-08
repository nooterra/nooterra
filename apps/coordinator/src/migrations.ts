import fs from "fs/promises";
import path from "path";
import { pool } from "./db.js";

const migrationsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../migrations");

async function ensureMigrationsTable() {
  await pool.query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz default now()
    );
  `);
}

async function listMigrationFiles(): Promise<string[]> {
  const files = await fs.readdir(migrationsDir).catch(() => []);
  return files.filter(f => f.endsWith(".sql")).sort();
}

async function appliedMigrations(): Promise<Set<string>> {
  await ensureMigrationsTable();
  const res = await pool.query<{ version: string }>(`select version from schema_migrations`);
  return new Set(res.rows.map(r => r.version));
}

export async function pendingMigrations(): Promise<string[]> {
  const files = await listMigrationFiles();
  const applied = await appliedMigrations();
  return files.filter(f => !applied.has(f));
}

export async function applyMigrations(): Promise<void> {
  await ensureMigrationsTable();
  const pending = await pendingMigrations();
  for (const file of pending) {
    const fullPath = path.join(migrationsDir, file);
    const sql = await fs.readFile(fullPath, "utf-8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(`insert into schema_migrations (version) values ($1)`, [file]);
      await client.query("commit");
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      await client.query("rollback");
      console.error(`[migrate] failed on ${file}`, err);
      throw err;
    } finally {
      client.release();
    }
  }
}

export async function assertNoPendingMigrations(): Promise<void> {
  const pending = await pendingMigrations();
  if (pending.length) {
    throw new Error(`pending migrations: ${pending.join(", ")}`);
  }
}
