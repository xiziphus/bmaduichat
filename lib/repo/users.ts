/**
 * Users repository (Epic F, multi mode only). Server-side only; callers must
 * gate on isPersistenceEnabled() before invoking.
 *
 * Passwords are scrypt-hashed (lib/auth) and stored self-describing; a plaintext
 * password is NEVER stored, logged, or selected — the only time one exists is the
 * one-time value returned by the admin create/reset routes. `list()` deliberately
 * omits password_hash so it can never leak.
 *
 * Optional `exec` executor lets tests assert SQL/param shape against a mock (same
 * convention as the other repos).
 */
import { query, type QueryFn } from '@/lib/db';
import { type Role } from '@/lib/auth';
import { hashPassword } from '@/lib/password';

export type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  created: string;
};

/** A user without the hash — safe to return from list/admin surfaces. */
export type PublicUser = {
  id: string;
  username: string;
  role: Role;
  created: string;
};

const PUBLIC_COLUMNS = 'id, username, role, created';

/** Normalize a username to its stored form (trimmed, lowercased). */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Look up a user by (normalized) username — includes the hash for verify. */
export async function findByUsername(
  username: string,
  exec: QueryFn = query,
): Promise<UserRow | null> {
  const rows = await exec<UserRow>(
    `SELECT id, username, password_hash, role, created
       FROM users
      WHERE username = $1`,
    [normalizeUsername(username)],
  );
  return rows[0] ?? null;
}

/** Fetch a user by id (public shape — no hash), or null. */
export async function getById(id: string, exec: QueryFn = query): Promise<PublicUser | null> {
  const rows = await exec<PublicUser>(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Fetch a user by id INCLUDING the hash — for change-password verification. */
export async function findById(id: string, exec: QueryFn = query): Promise<UserRow | null> {
  const rows = await exec<UserRow>(
    `SELECT id, username, password_hash, role, created FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** How many admins exist (used by bootstrap). */
export async function countAdmins(exec: QueryFn = query): Promise<number> {
  const rows = await exec<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'`,
  );
  return rows[0]?.n ?? 0;
}

/** All users, newest first, WITHOUT the hash. */
export async function list(exec: QueryFn = query): Promise<PublicUser[]> {
  return exec<PublicUser>(
    `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY created DESC`,
  );
}

export type CreateUserInput = {
  username: string;
  /** Plaintext — hashed here, never stored/logged in the clear. */
  password: string;
  role?: Role;
};

/**
 * Create a user with a scrypt-hashed password. Returns the public row (no hash).
 * `username` is stored normalized (unique). Duplicate usernames raise a Postgres
 * unique-violation the caller maps to 409.
 */
export async function createUser(
  input: CreateUserInput,
  exec: QueryFn = query,
): Promise<PublicUser> {
  const password_hash = await hashPassword(input.password);
  const rows = await exec<PublicUser>(
    `INSERT INTO users (username, password_hash, role)
          VALUES ($1, $2, $3)
       RETURNING ${PUBLIC_COLUMNS}`,
    [normalizeUsername(input.username), password_hash, input.role ?? 'user'],
  );
  return rows[0];
}

/** Set a user's password to a new scrypt hash. Returns true when a row changed. */
export async function setPassword(
  id: string,
  password: string,
  exec: QueryFn = query,
): Promise<boolean> {
  const password_hash = await hashPassword(password);
  const rows = await exec<{ id: string }>(
    `UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id`,
    [id, password_hash],
  );
  return rows.length > 0;
}

/**
 * Bootstrap the single admin from ADMIN_USERNAME / ADMIN_PASSWORD when multi mode
 * is on and no admin exists yet. Idempotent and safe to call repeatedly:
 *  - returns 'exists' when an admin is already present,
 *  - 'missing-env' when the env is not fully set (caller surfaces a clear error),
 *  - 'created' when it seeds the admin.
 * The admin is the only account not made by the admin.
 */
export async function ensureAdminFromEnv(
  exec: QueryFn = query,
): Promise<'created' | 'exists' | 'missing-env'> {
  if ((await countAdmins(exec)) > 0) return 'exists';
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return 'missing-env';
  await createUser({ username, password, role: 'admin' }, exec);
  return 'created';
}
