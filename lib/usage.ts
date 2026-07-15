/**
 * Token metering + monthly budget cap — pure logic (no DB, no env side effects).
 *
 * This is a SAFETY NET, not accounting. Prices are ESTIMATES documented as such;
 * token counts prefer the provider-reported numbers (Gemini `usageMetadata`,
 * OpenRouter final-chunk `usage`) and fall back to a ~4-chars/token estimate.
 * Free OpenRouter models cost 0 and never count toward the cap.
 */

import type { Provider } from '@/lib/llm';

/** USD per 1,000,000 tokens. ESTIMATES — exact numbers are not critical for a
 *  personal cap. Unknown models are treated as free (cost 0) so they never block. */
export type PriceRow = { in: number; out: number };

export const PRICES: Record<string, PriceRow> = {
  // ESTIMATE — approximate published Gemini 2.5 Flash rates.
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
};

/**
 * Conservative allowlist of OpenRouter models known to be free even when the id
 * does not carry a `:free` suffix. Kept small on purpose — when unsure we lean
 * toward NOT charging (a miss here just means we meter a genuinely-free call at
 * cost 0, since it also won't be in PRICES).
 */
export const OPENROUTER_FREE_MODELS: readonly string[] = [];

/**
 * A free model never counts toward the cap and never blocks. True when the id
 * contains `:free`, or (OpenRouter only) it's in the free allowlist.
 */
export function isFreeModel(provider: Provider, model: string | undefined | null): boolean {
  if (!model) return false;
  if (model.includes(':free')) return true;
  if (provider === 'openrouter' && OPENROUTER_FREE_MODELS.includes(model)) return true;
  return false;
}

/** Price row for a model, or undefined when unknown (→ treated as cost 0). */
export function priceFor(model: string | undefined | null): PriceRow | undefined {
  if (!model) return undefined;
  return PRICES[model];
}

/** ~4 characters per token — the standard rough estimate when no count is reported. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Prefer the provider-reported count; else estimate from the text (~4 chars/token). */
export function tokensOrEstimate(reported: number | null | undefined, text: string): number {
  return typeof reported === 'number' && reported >= 0 ? reported : estimateTokens(text);
}

/**
 * Estimated USD cost of a call. Free models → 0. Unknown models (not in PRICES)
 * → 0 so an untabled model never blocks. Otherwise tokens × per-1M price.
 */
export function estimateCost(input: {
  provider: Provider;
  model: string | undefined | null;
  tokensIn: number;
  tokensOut: number;
}): number {
  if (isFreeModel(input.provider, input.model)) return 0;
  const price = priceFor(input.model);
  if (!price) return 0;
  const cost = (input.tokensIn / 1_000_000) * price.in + (input.tokensOut / 1_000_000) * price.out;
  return cost > 0 ? cost : 0;
}

/** The monthly cap in USD from env `BUDGET_USD` (default 10). Non-numeric → 10. */
export function budgetCap(): number {
  const raw = process.env.BUDGET_USD;
  const n = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

export type CapLevel = 'ok' | 'warn' | 'blocked';

/**
 * Where month-to-date spend sits against the cap.
 *   ratio ≥ 1.0  → 'blocked'  (hard stop for billable requests)
 *   ratio ≥ 0.8  → 'warn'     (allow + one-time warning)
 *   else         → 'ok'
 * A non-positive cap yields ratio 0 / 'ok' (never blocks on misconfig).
 */
export function capStatus(spent: number, cap: number): { ratio: number; level: CapLevel } {
  const ratio = cap > 0 ? spent / cap : 0;
  const level: CapLevel = ratio >= 1 ? 'blocked' : ratio >= 0.8 ? 'warn' : 'ok';
  return { ratio, level };
}

/** The honest bubble shown when a billable request is blocked at 100% of cap. */
export function blockedMessage(cap: number): string {
  const capStr = Number.isInteger(cap) ? String(cap) : cap.toFixed(2);
  return `We've hit this month's $${capStr} budget — switch to a free OpenRouter model to keep going, or it resets next month.`;
}
