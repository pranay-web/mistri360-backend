/**
 * Standalone database migration script.
 *
 * Reads .sql files from the migrations/ directory and executes them
 * against the database specified by DATABASE_URL.
 *
 * Tracks applied migrations in a `schema_migrations` table to ensure
 * idempotency — safe to run multiple times.
 *
 * Usage:
 *   node --env-file-if-exists=.env src/scripts/migrate.js
 *   # or
 *   npm run migrate
 */

import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query(
    "SELECT filename FROM schema_migrations ORDER BY filename"
  );
  return new Set(result.rows.map((row) => row.filename));
}

async function getMigrationFiles() {
  // Resolve migrations dir relative to project root (two levels up from src/scripts/)
  const migrationsDir = path.resolve(__dirname, "../../migrations");

  if (!fs.existsSync(migrationsDir)) {
    console.log(`No migrations directory found at ${migrationsDir}`);
    return [];
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  return files.map((filename) => ({
    filename,
    filepath: path.join(migrationsDir, filename),
  }));
}

async function runMigrations() {
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const migrationFiles = await getMigrationFiles();

    if (migrationFiles.length === 0) {
      console.log("No migration files found.");
      return;
    }

    let appliedCount = 0;

    for (const { filename, filepath } of migrationFiles) {
      if (applied.has(filename)) {
        console.log(`  ⏭  ${filename} (already applied)`);
        continue;
      }

      console.log(`  ▶  Applying ${filename}...`);

      const sql = fs.readFileSync(filepath, "utf-8");

      await client.query("BEGIN");
      try {
        // Execute the migration SQL
        await client.query(sql);

        // Record the migration
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [filename]
        );

        await client.query("COMMIT");
        console.log(`  ✓  ${filename} applied successfully`);
        appliedCount++;
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`  ✗  ${filename} FAILED:`, err.message);
        throw err;
      }
    }

    if (appliedCount === 0) {
      console.log("All migrations already applied. Database is up to date.");
    } else {
      console.log(`\n${appliedCount} migration(s) applied successfully.`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

console.log("Running database migrations...");
console.log(`Database: ${DATABASE_URL.replace(/\/\/.*@/, "//***@")}\n`);

runMigrations().catch((err) => {
  console.error("\nMigration failed:", err);
  process.exit(1);
});
