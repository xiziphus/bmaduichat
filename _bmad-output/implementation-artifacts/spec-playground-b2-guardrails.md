---
title: 'Playground v2 — Epic B (part 2): budget cap + server-side builder outbox'
type: 'feature'
created: '2026-07-16'
status: 'ready-for-dev'
baseline_commit: '6f1d4bb'
context:
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-Playground-2026-07-16/prd.md'
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** (1) No spend guardrail — a chatty week on Gemini could surprise the builder with a bill. (2) Builder notes live only in the browser (localStorage), so "noted for the builder" is lost across devices and never reaches the builder.

**Approach:** Meter token usage per request into the `usage` table, enforce a monthly USD cap (default $10) with an 80% warning and a 100% honest hard-stop — free OpenRouter models never count or block. Move builder notes to the `builder_notes` Neon table with conversation context, add a consent "send" that flags them builder-visible, and a builder-only view.

## Boundaries & Constraints

**Always:**
- **Metering (B-4):** after each successful chat completion, capture token counts (prefer provider-reported: Gemini `usageMetadata`, OpenRouter final-chunk `usage`; else estimate ~4 chars/token) and write a `usage` row (provider, model, tokens_in, tokens_out, cost_est). A small per-model price table (USD per 1M tokens) computes `cost_est`; unknown model → 0. **Free OpenRouter models (model id ends `:free` or in a free list) cost 0 and never count toward the cap.**
- **Cap enforcement:** cap = `BUDGET_USD` env (default 10), per calendar month (sum `cost_est` for the current month). Before a *billable* request: if month-to-date ≥ 100% → block with an honest assistant bubble ("We've hit this month's $10 budget — switch to a free OpenRouter model to keep going, or it resets next month."). At ≥ 80% → allow but surface a one-time warning toast/banner. Free-model requests always allowed. A small budget meter in the chat header (spent/cap) for the builder.
- **Builder notes server-side (B-5):** when an assistant reply contains "noted for the builder" (existing detection), write a `builder_notes` row (conversation_id, excerpt, status `collected`) — in addition to / replacing the localStorage capture. The 📮 drawer reads from `/api/builder-notes` (authed). Consent: a "Send to builder" action flips selected rows to `status='sent'`. A builder view (e.g. `/api/builder-notes?status=sent` or a simple page) lists sent notes with their conversation.
- Graceful: no DB → metering is a no-op (no cap enforcement, no usage rows), builder notes fall back to the existing localStorage behavior; zero errors. Auth on all routes.

**Ask First:**
- Hard-blocking on the *free* tier (never — free must always work).
- Any real billing/payment integration.

**Never:**
- Don't count or block free-model usage.
- Don't lose the honest-degradation UX — a blocked request still explains itself, never a silent failure.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Billable request under cap | Gemini, 40% spent | proceeds; usage row written | provider error → no usage row |
| Crossing 80% | spend hits 8/10 | warning toast/banner once | N/A |
| At/over 100% | 10/10, Gemini | request blocked, honest bubble suggesting free model | N/A |
| Free-model request at 100% | OpenRouter `:free` | proceeds normally, no count | N/A |
| Note detected | reply has "noted for the builder" | builder_notes row (collected) + drawer shows it | DB off → localStorage as today |
| Send notes | click Send in drawer | rows → status sent; builder view shows them | N/A |
| DB off | any | no metering/cap, localStorage notes, no errors | N/A |

</frozen-after-approval>

## Code Map

- `lib/usage.ts` -- price table, token extraction (provider + estimate), `isFreeModel`, `monthToDateSpend`, `capStatus`
- `lib/repo/usage.ts` -- insert usage, sum current month
- `lib/repo/builder-notes.ts` -- insert (collected), list by status, mark sent
- `app/api/chat/route.ts` -- pre-check cap (block billable at 100%), post-write usage; write builder-note rows on detection
- `app/api/builder-notes/route.ts` -- authed GET (list) + POST (mark sent)
- `app/api/usage/route.ts` -- authed GET month-to-date (for the header meter)
- `components/ChatPane.tsx` -- budget meter (builder), 80% warning toast, blocked-bubble handling; 📮 drawer reads server notes + Send action
- `lib/llm.ts` -- surface provider-reported token usage from the stream tail (Gemini usageMetadata / OpenRouter usage) to the route
- `README.md` / `.env.example` -- `BUDGET_USD`, free-model note
- tests -- price/cost calc, isFreeModel, capStatus thresholds (79/80/100%), note insert/send shape

## Tasks & Acceptance

**Execution:**
- [ ] `lib/usage.ts` + `lib/repo/usage.ts` -- pricing, extraction, month spend, cap status
- [ ] `lib/llm.ts` -- expose token usage from stream tail
- [ ] `app/api/chat/route.ts` -- cap pre-check + usage write + builder-note write
- [ ] `lib/repo/builder-notes.ts` + `app/api/builder-notes/route.ts` -- server notes + send
- [ ] `app/api/usage/route.ts` + `components/ChatPane.tsx` -- meter, warning, blocked bubble, server-backed 📮 drawer
- [ ] `README.md` / `.env.example` -- BUDGET_USD
- [ ] tests

**Acceptance Criteria:**
- Given Gemini spend at 100% of the month cap, when I send on Gemini, then it's blocked with an honest bubble; switching to a free OpenRouter model lets me continue.
- Given spend crosses 80%, when I send, then I see a one-time warning.
- Given a reply says "noted for the builder", then a note persists server-side and appears in the 📮 drawer across devices; sending flips it to the builder view.
- Given no DATABASE_URL, then no cap/metering and notes fall back to localStorage; `npm run build` clean; `npm test` green; no regressions.

## Design Notes

**Price table (starting, USD / 1M tokens, builder-tunable):** gemini-2.5-flash ~{in:0.30, out:2.50} (approx — mark as an estimate, exact numbers not critical for a personal cap); OpenRouter `:free` = 0; unknown = 0 (never blocks). The cap is a *safety net*, not accounting — estimates are fine and must be documented as such.

**Free detection:** model id contains `:free` OR provider openrouter with an env `OPENROUTER_MODEL` in a small free list. Keep it simple and conservative (when unsure, treat as free = never block).

## Verification

`npm run build` clean · `npm test` green · Manual (DB on): meter shows spend; force cap (low BUDGET_USD) → Gemini blocked, free model works; trigger a builder note → appears in drawer → Send → builder view.
