import { describe, it, expect, afterEach } from 'vitest';
import {
  isFreeModel,
  priceFor,
  estimateTokens,
  tokensOrEstimate,
  estimateCost,
  capStatus,
  budgetCap,
  blockedMessage,
  PRICES,
} from '@/lib/usage';
import type { QueryFn } from '@/lib/db';
import { buildInsertUsageQuery, insertUsage, monthToDateSpend } from '@/lib/repo/usage';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Records the last SQL text + params, returns a canned row set. */
function mockExec(rows: unknown[] = []) {
  const calls: { text: string; params: unknown[] }[] = [];
  const exec: QueryFn = async (text, params = []) => {
    calls.push({ text, params });
    return rows as never;
  };
  return { exec, calls };
}

describe('isFreeModel', () => {
  it('treats any id containing :free as free', () => {
    expect(isFreeModel('openrouter', 'meta-llama/llama-3.3-70b-instruct:free')).toBe(true);
    expect(isFreeModel('gemini', 'something:free')).toBe(true);
  });
  it('treats paid ids as billable', () => {
    expect(isFreeModel('gemini', 'gemini-2.5-flash')).toBe(false);
    expect(isFreeModel('openrouter', 'openai/gpt-4o')).toBe(false);
  });
  it('null/empty model is not free', () => {
    expect(isFreeModel('gemini', undefined)).toBe(false);
    expect(isFreeModel('openrouter', '')).toBe(false);
  });
});

describe('price / cost calc', () => {
  it('has an ESTIMATE row for gemini-2.5-flash', () => {
    expect(PRICES['gemini-2.5-flash']).toEqual({ in: 0.3, out: 2.5 });
    expect(priceFor('gemini-2.5-flash')).toEqual({ in: 0.3, out: 2.5 });
    expect(priceFor('nope')).toBeUndefined();
  });
  it('computes cost from per-1M pricing', () => {
    // 1M in @0.30 + 1M out @2.50 = 2.80
    expect(estimateCost({ provider: 'gemini', model: 'gemini-2.5-flash', tokensIn: 1_000_000, tokensOut: 1_000_000 })).toBeCloseTo(2.8, 6);
    // 1000 in + 500 out
    expect(estimateCost({ provider: 'gemini', model: 'gemini-2.5-flash', tokensIn: 1000, tokensOut: 500 })).toBeCloseTo(0.0003 + 0.00125, 9);
  });
  it('free models cost 0 even with a price row', () => {
    expect(estimateCost({ provider: 'openrouter', model: 'x:free', tokensIn: 9_000_000, tokensOut: 9_000_000 })).toBe(0);
  });
  it('unknown (untabled) models cost 0 so they never block', () => {
    expect(estimateCost({ provider: 'openrouter', model: 'openai/gpt-4o', tokensIn: 1_000_000, tokensOut: 1_000_000 })).toBe(0);
  });
});

describe('token estimation', () => {
  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
  it('prefers a reported count, else estimates', () => {
    expect(tokensOrEstimate(123, 'ignored text')).toBe(123);
    expect(tokensOrEstimate(0, 'ignored')).toBe(0);
    expect(tokensOrEstimate(null, 'abcd')).toBe(1);
    expect(tokensOrEstimate(undefined, 'abcdefgh')).toBe(2);
  });
});

describe('capStatus thresholds (79 / 80 / 100%)', () => {
  it('79% is ok', () => {
    expect(capStatus(7.9, 10).level).toBe('ok');
  });
  it('80% is warn', () => {
    expect(capStatus(8, 10).level).toBe('warn');
  });
  it('100% (and over) is blocked', () => {
    expect(capStatus(10, 10).level).toBe('blocked');
    expect(capStatus(12, 10).level).toBe('blocked');
  });
  it('reports the ratio', () => {
    expect(capStatus(5, 10).ratio).toBeCloseTo(0.5, 6);
  });
  it('a non-positive cap never blocks', () => {
    expect(capStatus(100, 0).level).toBe('ok');
  });
});

describe('budgetCap (env BUDGET_USD, default 10)', () => {
  const prev = process.env.BUDGET_USD;
  afterEach(() => {
    if (prev === undefined) delete process.env.BUDGET_USD;
    else process.env.BUDGET_USD = prev;
  });
  it('defaults to 10 when unset or non-numeric', () => {
    delete process.env.BUDGET_USD;
    expect(budgetCap()).toBe(10);
    process.env.BUDGET_USD = 'abc';
    expect(budgetCap()).toBe(10);
  });
  it('reads a numeric override', () => {
    process.env.BUDGET_USD = '3';
    expect(budgetCap()).toBe(3);
    process.env.BUDGET_USD = '0.5';
    expect(budgetCap()).toBe(0.5);
  });
});

describe('blockedMessage', () => {
  it('names the cap and points at free models', () => {
    const m = blockedMessage(10);
    expect(m).toContain('$10');
    expect(m).toMatch(/free/i);
  });
});

describe('usage repo — SQL/param shape', () => {
  it('buildInsertUsageQuery inserts the five metering columns', () => {
    const q = buildInsertUsageQuery({ provider: 'gemini', model: 'gemini-2.5-flash', tokensIn: 100, tokensOut: 50, costEst: 0.001 });
    expect(norm(q.text)).toContain('INSERT INTO usage (provider, model, tokens_in, tokens_out, cost_est)');
    expect(q.params).toEqual(['gemini', 'gemini-2.5-flash', 100, 50, 0.001]);
  });
  it('insertUsage runs the INSERT with the same params', async () => {
    const { exec, calls } = mockExec([]);
    await insertUsage({ provider: 'openrouter', model: 'm', tokensIn: 1, tokensOut: 2, costEst: 0 }, exec);
    expect(norm(calls[0].text)).toContain('INSERT INTO usage');
    expect(calls[0].params).toEqual(['openrouter', 'm', 1, 2, 0]);
  });
  it('monthToDateSpend sums cost_est for the current month, defaulting to 0', async () => {
    const { exec, calls } = mockExec([{ spend: 4.25 }]);
    const spend = await monthToDateSpend(exec);
    const sql = norm(calls[0].text);
    expect(sql).toContain('SUM(cost_est)');
    expect(sql).toContain("date_trunc('month', now())");
    expect(spend).toBe(4.25);
  });
  it('monthToDateSpend returns 0 when there are no rows', async () => {
    const { exec } = mockExec([]);
    expect(await monthToDateSpend(exec)).toBe(0);
  });
});
