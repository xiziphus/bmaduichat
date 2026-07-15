/**
 * Usage repository — token/cost metering rows. Server-side only.
 *
 * Optional `exec` executor lets tests assert SQL/param shape against a mock.
 * Callers must gate on isPersistenceEnabled() before invoking.
 */
import { query, type QueryFn, type TxQuery } from '@/lib/db';

export type UsageInput = {
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costEst: number;
};

/** Build a parametrized INSERT for one usage row (transaction-safe, no RETURNING). */
export function buildInsertUsageQuery(input: UsageInput): TxQuery {
  return {
    text: `INSERT INTO usage (provider, model, tokens_in, tokens_out, cost_est)
                VALUES ($1, $2, $3, $4, $5)`,
    params: [input.provider, input.model, input.tokensIn, input.tokensOut, input.costEst],
  };
}

/** Insert one usage row. */
export async function insertUsage(input: UsageInput, exec: QueryFn = query): Promise<void> {
  const { text, params } = buildInsertUsageQuery(input);
  await exec(text, params);
}

/**
 * Sum of `cost_est` for the current calendar month (UTC), as a number. Returns 0
 * when there are no rows. Powers the cap check + the header meter.
 */
export async function monthToDateSpend(exec: QueryFn = query): Promise<number> {
  const rows = await exec<{ spend: number }>(
    `SELECT COALESCE(SUM(cost_est), 0)::float8 AS spend
       FROM usage
      WHERE created >= date_trunc('month', now())`,
  );
  const spend = rows[0]?.spend;
  return typeof spend === 'number' ? spend : Number(spend ?? 0);
}
