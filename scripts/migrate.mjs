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
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { neon } from '@neondatabase/serverless';

const scryptAsync = promisify(scrypt);

// Same self-describing scrypt format the app uses (lib/auth.ts): 16-byte salt +
// 64-byte derived key, both hex, joined `scrypt$salt$hash`. Kept in sync so the
// bootstrapped admin verifies against the app's verifyPassword.
async function hashPassword(plain) {
  const salt = randomBytes(16);
  const dk = await scryptAsync(plain, salt, 64);
  return `scrypt$${salt.toString('hex')}$${dk.toString('hex')}`;
}

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

// Strip line comments FIRST (they can contain semicolons, which would
// otherwise break the split), then split into individual statements. The
// schema uses no semicolons inside string literals or dollar-quoted bodies.
const statements = schema
  .replace(/--.*$/gm, '')
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const sql = neon(url);

let applied = 0;
for (const stmt of statements) {
  // Call the Neon http client as an ordinary function to run raw SQL.
  await sql(stmt);
  applied += 1;
}

console.log(`Migration complete — applied ${applied} statement(s) to the Neon database.`);

// Multi-user bootstrap (Epic F). Only runs when AUTH_MODE=multi; in shared mode
// this whole block is skipped, so migrate behaves exactly as before. Seeds the
// single admin from env when none exists, then backfills any unowned
// conversations to the admin. All steps are idempotent (safe to re-run).
if (process.env.AUTH_MODE === 'multi') {
  const [{ n: adminCount }] = await sql(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'`);
  if (adminCount === 0) {
    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;
    if (!username || !password) {
      console.error(
        'AUTH_MODE=multi but ADMIN_USERNAME / ADMIN_PASSWORD are not set — no admin was bootstrapped. ' +
          'Set both and re-run `npm run db:migrate` to enable multi-user mode.',
      );
    } else {
      const name = username.trim().toLowerCase();
      await sql(`INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')`, [
        name,
        await hashPassword(password),
      ]);
      console.log(`Bootstrapped admin "${name}".`);
    }
  } else {
    console.log('Admin already present — skipping bootstrap.');
  }

  // Backfill existing conversations to the admin so pre-multi work stays visible
  // (only NULL rows are touched, so this is safe on every re-run).
  const admins = await sql(`SELECT id FROM users WHERE role = 'admin' ORDER BY created ASC LIMIT 1`);
  const adminId = admins[0]?.id;
  if (adminId) {
    const updated = await sql(
      `UPDATE conversations SET user_id = $1 WHERE user_id IS NULL RETURNING id`,
      [adminId],
    );
    if (updated.length > 0) {
      console.log(`Backfilled ${updated.length} conversation(s) to the admin.`);
    }
  }
}
