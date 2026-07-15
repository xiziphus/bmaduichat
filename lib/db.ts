/**
 * Neon Postgres data layer — server-side only.
 *
 * Graceful degradation is the contract: when DATABASE_URL is unset,
 * `isPersistenceEnabled()` returns false and no query is ever attempted, so the
 * app runs exactly as it does today (ephemeral, no crash). The Neon client is
 * created lazily on first use, never at import time, so importing this module is
 * safe even with no database configured.
 *
 * Never import this from client components or middleware — DATABASE_URL and all
 * queries must stay on the server. `server-only` makes that a build-time error.
 */
import 'server-only';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

/** A parametrized query executor. Rows are returned as plain objects. */
export type QueryFn = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

/** A parametrized statement to run inside a transaction. */
export type TxQuery = { text: string; params: unknown[] };

/** True only when a non-empty DATABASE_URL is configured. */
export function isPersistenceEnabled(): boolean {
  const url = process.env.DATABASE_URL;
  return typeof url === 'string' && url.trim().length > 0;
}

let client: NeonQueryFunction<false, false> | null = null;

function getClient(): NeonQueryFunction<false, false> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // Callers must gate on isPersistenceEnabled(); this is a safety net.
    throw new Error('DATABASE_URL is not set — persistence is disabled');
  }
  if (!client) client = neon(url);
  return client;
}

/** Run a parametrized SQL statement and return the rows. Server-side only. */
export const query: QueryFn = async (text, params = []) => {
  const sql = getClient();
  // Neon's http client runs a parametrized query when called as an ordinary
  // function: sql(text, params) with $1, $2… placeholders.
  const rows = await sql(text, params);
  return rows as never;
};

/**
 * Run several statements as a single non-interactive Postgres transaction over
 * one HTTP round-trip. All-or-nothing: any statement failing rolls back the
 * whole batch. Server-side only; caller must gate on isPersistenceEnabled().
 */
export async function transaction(queries: TxQuery[]): Promise<void> {
  const sql = getClient();
  await sql.transaction(queries.map((q) => sql(q.text, q.params)));
}
