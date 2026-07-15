---
title: 'Playground v2 — Epic A stories A-1 + A-2: Neon data layer + conversation/message persistence'
type: 'feature'
created: '2026-07-16'
status: 'ready-for-dev'
baseline_commit: '2f11442'
context:
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-Playground-2026-07-16/prd.md'
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-Playground-2026-07-16/addendum.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epics-playground-v2.md'
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** The live app is stateless — conversations vanish on refresh / "New conversation", the sidebar is fake demo data. Nothing persists.

**Approach:** Add a Neon Postgres data layer with the full v2 schema (addendum), then make conversations + messages real: persisted server-side, listed in the sidebar from the DB, rehydrated on open. **Graceful degradation is mandatory:** if `DATABASE_URL` is unset, the app must run exactly as it does today (ephemeral, no crash) so the live deployment never breaks before the builder provisions Neon.

## Boundaries & Constraints

**Always:**
- Create the FULL schema from the addendum now (`conversations, messages, artifacts, workflow_runs, run_events, builder_notes, usage`) even though only conversations/messages/(artifacts stub) are used this story — Phase C reuses it, no later migration.
- `@neondatabase/serverless` driver. A thin typed query helper is fine; Drizzle acceptable if it stays lightweight. No heavy ORM.
- DB access server-side only (route handlers / server actions). Never expose `DATABASE_URL` or queries to the client.
- If `DATABASE_URL` is absent: `isPersistenceEnabled()` returns false; all persistence calls become no-ops; UI falls back to today's in-memory behavior; a subtle builder-only hint may note "persistence off". No user-facing error.
- Keep the existing shared-password auth on every new route.

**Ask First:**
- Any schema change beyond the addendum sketch.
- Adding a migration framework heavier than a plain SQL file + runner.

**Never:**
- No doc-pane/artifact rendering yet (that's A-3), no export (A-4), no rename/@refer (Epic B). Create the `artifacts` table but leave it unused beyond an empty accessor.
- No breaking the live app when DB is unconfigured.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Send w/ DB | authed, DATABASE_URL set | conversation upserted, user+assistant messages appended after stream completes | tx rolled back on failure, chat still shows reply |
| Load sidebar | authed, DB set | lists real non-archived conversations, newest first | empty list if none |
| Reopen conversation | click sidebar item | full message thread rehydrates in order | missing id → 404, sidebar refreshes |
| New conversation | click button | new row; prior conversation remains listed (archived=false, not deleted) | N/A |
| DB unset | no DATABASE_URL | app behaves exactly like today (ephemeral); no errors | all persistence no-ops |
| DB error mid-request | query throws | reply still streams; persistence failure logged, not surfaced to Vee | 200 to client |

</frozen-after-approval>

## Code Map

- `lib/db.ts` -- Neon client, `isPersistenceEnabled()`, typed query helpers
- `db/schema.sql` + `scripts/migrate.mjs` -- full v2 schema + `npm run db:migrate`
- `lib/repo/conversations.ts`, `lib/repo/messages.ts` -- CRUD used this story; stub `lib/repo/artifacts.ts`
- `app/api/conversations/route.ts` (GET list, POST new), `app/api/conversations/[id]/route.ts` (GET thread, PATCH archive) -- authed
- `app/api/chat/route.ts` -- persist user msg on receipt + assistant msg after stream (server-side), when enabled
- `components/Sidebar.tsx`, `components/ChatPane.tsx`, `app/page.tsx` -- load real conversations, select/rehydrate, wire "New conversation" to a real row
- `README.md`, `.env.example` -- add `DATABASE_URL` (+ note: optional; app runs without it)

## Tasks & Acceptance

**Execution:**
- [ ] `db/schema.sql` + `scripts/migrate.mjs` + `package.json` db:migrate -- full addendum schema
- [ ] `lib/db.ts` -- driver + `isPersistenceEnabled()` + helpers
- [ ] `lib/repo/*.ts` -- conversations/messages CRUD (+ artifacts stub)
- [ ] `app/api/conversations/*` -- authed list/new/thread/archive
- [ ] `app/api/chat/route.ts` -- append messages when enabled (after stream), no-op otherwise
- [ ] `components/*` + `app/page.tsx` -- sidebar from DB, rehydrate on open, real New conversation; graceful when disabled
- [ ] `README.md` + `.env.example` -- DATABASE_URL documented as optional
- [ ] Tests -- repo helpers against a mock/param check; `isPersistenceEnabled` both states; chip/stream unaffected

**Acceptance Criteria:**
- Given DATABASE_URL set + migrated, when I chat then refresh, then the full thread and sidebar persist and rehydrate.
- Given "New conversation", when clicked, then a new row is created and the previous conversation still appears in the sidebar.
- Given DATABASE_URL is UNSET, when I use the app, then it behaves exactly like the current live version with zero errors.
- Given `npm run build`, then zero type errors; `npm test` green; the live app (no DB) is unaffected.

## Verification

**Commands:**
- `npm run build` -- clean
- `npm test` -- green
- `node scripts/migrate.mjs` against a scratch Neon branch (if a URL is provided) -- tables created

**Manual:**
- With a Neon URL in `.env`: chat, refresh, confirm resume; without it: confirm app still works.
