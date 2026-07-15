---
title: 'Playground v2 — Epic B (part 1): conversations UX — rename, @-reference, cross-reads, selection'
type: 'feature'
created: '2026-07-16'
status: 'ready-for-dev'
baseline_commit: 'fe6536f'
context:
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-Playground-2026-07-16/prd.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epics-playground-v2.md'
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** Conversations exist but are inert: can't rename them, can't reference one from another, the agent can't pull in a related conversation, and a refresh drops you on the newest conversation rather than the one you were in.

**Approach:** Make conversations first-class — inline rename, `@` autocomplete referencing conversations/artifacts (injected as agent context), agents may read referenced material and must cite it, and the app restores the conversation you were viewing.

## Boundaries & Constraints

**Always:**
- **Rename (B-1):** inline-edit the conversation title in the sidebar (double-click or a pencil affordance) → PATCH `/api/conversations/[id]` `{title}`; persists; optimistic UI. Empty title → falls back to an auto-title.
- **Selection + restore (polish):** clicking a sidebar conversation loads its thread + its latest artifact (verify this works). Persist the active conversation id (localStorage) so a refresh restores THAT conversation, not merely the newest. New conversation still creates + selects a fresh row.
- **@-reference (B-2):** typing `@` in the composer opens an autocomplete over conversations (by title) and artifacts (by title); picking one inserts a chip-like token `@[title]` bound to its id/type. On send, the client passes the referenced ids; the server resolves them to content (conversation → recent messages/summary; artifact → its markdown) and injects them into the model context as clearly-delimited reference blocks. Cap injected size (truncate long references with a note).
- **Cross-reads + citation (B-3):** the system prompt instructs the agent that referenced material is provided and that it must **cite what it used** ("Reading @travel-pitch…") and never silently absorb it. Single-tenant, so any conversation/artifact is in scope.
- **Reference resolution endpoint:** an authed route (e.g. GET `/api/references?q=`) returns matching conversations + artifacts for the autocomplete; and the chat route accepts `references: [{type,id}]` and does the injection server-side (never trust client-sent content).
- Graceful: no DB → `@` autocomplete returns empty, rename is a no-op past the current session, selection restore falls back to today; zero errors. Auth on all routes.

**Ask First:**
- Summarizing long referenced conversations with an extra model call (vs. simple truncation) — default to truncation.

**Never:**
- No budget cap or builder-outbox work (that's Epic B part 2). No runtime work (Epic C).
- Don't let the client send reference *content* — only ids; server resolves.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Rename | edit title, blur/enter | title persists, sidebar updates | empty → auto-title; DB off → session-only |
| Select conversation | click sidebar item | thread + latest artifact load | missing → refresh list |
| Refresh | was in convo X | convo X restored (localStorage id) | id gone → newest |
| Type `@` | composer | autocomplete of conversations+artifacts | none → "no matches" |
| Send with `@ref` | referenced convo/artifact | server injects its content; agent cites it | ref deleted → skipped w/ note |
| Big reference | 50-message convo | truncated w/ "(truncated)" note, within budget | N/A |
| DB off | any | autocomplete empty, rename session-only, no errors | N/A |

</frozen-after-approval>

## Code Map

- `app/api/conversations/[id]/route.ts` -- extend PATCH to accept `{title}`
- `app/api/references/route.ts` -- authed search over conversations + artifacts
- `app/api/chat/route.ts` -- accept `references`, resolve + inject as context blocks (server-side)
- `lib/repo/conversations.ts`, `lib/repo/artifacts.ts` -- title update; search helpers; fetch-for-injection
- `lib/references.ts` -- resolve refs → delimited context blocks, size budget/truncation
- `components/Sidebar.tsx` -- inline rename, active selection styling
- `components/ChatPane.tsx` -- `@` autocomplete popover, reference tokens, pass ids on send
- `app/page.tsx` -- persist/restore active conversation id (localStorage)
- `lib/mary.ts` -- citation rule for referenced material
- tests -- reference resolution/truncation, title update shape, @-parse

## Tasks & Acceptance

**Execution:**
- [ ] `app/api/conversations/[id]/route.ts` + repo -- rename
- [ ] `components/Sidebar.tsx` -- inline rename + active selection
- [ ] `app/page.tsx` -- restore active conversation on load
- [ ] `app/api/references/route.ts` + repo search -- autocomplete source
- [ ] `components/ChatPane.tsx` -- `@` autocomplete + reference tokens
- [ ] `lib/references.ts` + `app/api/chat/route.ts` -- server-side resolve + inject (budgeted)
- [ ] `lib/mary.ts` -- cite-what-you-read rule
- [ ] tests

**Acceptance Criteria:**
- Given a conversation, when I rename it, then the new title persists across refresh.
- Given I was in conversation X, when I refresh, then X reloads (not just the newest).
- Given I type `@` and pick a past conversation, when I send, then the agent references its content and says it used it.
- Given a referenced artifact, when the agent replies, then it uses the artifact's content and cites it.
- Given no DATABASE_URL, the app still runs (autocomplete empty, rename session-only); `npm run build` clean; `npm test` green; no regressions to chat/markdown/attachments/doc pane.

## Design Notes

**Reference injection format:** delimited, e.g. `\n\n--- Referenced: "@Travel pitch" (conversation) ---\n<content or truncated>\n--- end ---`. Injected into the user turn or a system addendum for that request only. Keep it clearly bounded so the agent treats it as reference, not instruction.

**@-parse:** track reference tokens in composer state (id+type+title), render as pills; strip the raw `@[...]` from display text; send `references[]` separately from the typed text.

## Verification

`npm run build` clean · `npm test` green · Manual (DB on): rename persists; refresh restores; `@` a prior convo → agent cites it.
