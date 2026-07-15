#!/usr/bin/env node
/**
 * Idempotent schema migration for the Playground Neon database.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npm run db:migrate
 *
 * Reads db/schema.sql and applies each statement over the Neon HTTP driver.
 * Every statement is CREATE ... IF NOT EXISTS, so re-runs are safe. If
 * DATABASE_URL is unset this exits with a clear message (nothing to migrate) —
 * the app itself runs fine without a database.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'DATABASE_URL is not set — nothing to migrate. Set it to a Neon connection string and re-run.',
  );
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, '..', 'db', 'schema.sql');
const schema = readFileSync(schemaPath, 'utf8');

// Split into individual statements. The schema uses no semicolons inside
// literals or dollar-quoted bodies, so a naive split on ';' is safe here.
// Fragments that are only SQL comments/whitespace are dropped.
const statements = schema
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.replace(/--.*$/gm, '').trim().length > 0);

const sql = neon(url);

let applied = 0;
for (const stmt of statements) {
  // Call the Neon http client as an ordinary function to run raw SQL.
  await sql(stmt);
  applied += 1;
}

console.log(`Migration complete — applied ${applied} statement(s) to the Neon database.`);
