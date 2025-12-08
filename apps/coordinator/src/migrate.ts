import { applyMigrations } from "./migrations.js";

async function main() {
  try {
    await applyMigrations();
    console.log("Migrations applied successfully.");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

main();
