---
title: "Playground v2 — Epics & Stories (Implementation Plan)"
status: active
created: 2026-07-16
source_prd: "../planning-artifacts/prds/prd-Playground-2026-07-16/prd.md"
---

# Playground v2 — Implementation Plan

Story-by-story build sequence derived from the v2 PRD. Four epics = four phases (A→D), sequenced per the goals-first decision. Each story is independently shippable and deployable; the app stays live at every step. Division of labor: Fable specs & reviews each story; Opus/Sonnet subagents implement. `[P]` = provider/QStash cost enters here.

**Lettered stories** so `A2` never collides with `A10` in tooling.

---

## Epic A — Statefulness & the Document (FR-1..5) · *~1.5–2 focused days*

Goal: nothing is lost on refresh; brainstorm synthesis becomes a real saved, formatted document. Schema is designed **runtime-shaped now** (so Phase C reuses it, no migration).

- **A-1 · Data layer.** Add Neon (`@neondatabase/serverless` + a thin query helper or Drizzle). Create the full v2 schema from the addendum (`conversations, messages, artifacts, workflow_runs, run_events, builder_notes, usage`) even though A only uses the first three — the rest sit empty until C/B. Migration script + `DATABASE_URL` env. *AC:* `npm run db:migrate` creates all tables; a smoke query round-trips.
- **A-2 · Persist conversations & messages (FR-1, FR-5).** On send, upsert conversation + append messages server-side; sidebar lists real conversations from Neon; opening one rehydrates the thread; "New conversation" creates a row (archives, never deletes). Replace the demo sidebar data. *AC:* refresh mid-thread → exact resume; new conversation → prior one still in sidebar.
- **A-3 · Artifacts + live doc pane (FR-2, FR-3).** `artifacts` rows tied to a conversation; when Mary produces a wrap-up/synthesis, write an artifact and render it live in the doc pane with the mock's typography (markdown → styled HTML). Versioned on regenerate. *AC:* finishing a brainstorm fills the doc pane with a saved, formatted document that survives refresh.
- **A-4 · Export & artifact URL (FR-4).** Copy-markdown, print-CSS PDF, and a stable authed `/artifacts/[id]` route (sandboxed render). *AC:* the three export paths work; the URL renders the same doc, auth-gated.

## Epic B — Conversations UX & Guardrails (FR-10..12, 20..22) · *~1.5–2 days* `[P]`

- **B-1 · Rename (FR-10).** Inline rename in the sidebar, persisted. *AC:* rename survives refresh.
- **B-2 · @-reference (FR-11).** `@` autocomplete over conversations + artifacts; selected reference injected into the agent's context on the next turn. *AC:* `@travel-pitch` makes that content available to Mary; she can quote it.
- **B-3 · Cross-conversation reads (FR-12).** Agent may pull a referenced/related conversation's content and must cite it. *AC:* Mary says "reading @X…" and uses it; never silently.
- **B-4 · Usage metering + budget cap (FR-20).** Write `usage` rows per request (token counts × model price table); monthly rollup; 80% warning banner; 100% hard-stop with honest message; free OpenRouter models never counted against the cap. *AC:* simulated spend crosses 80%→warn, 100%→block Gemini but not free OpenRouter.
- **B-5 · Server-side builder notes + outbox (FR-21, FR-22).** Move the 📮 ledger from localStorage to `builder_notes` (Neon), with conversation context; consent "send" flips rows to builder-visible; a builder-only view lists sent notes. *AC:* a "noted for the builder" moment persists across browsers; sending flags it; builder view shows it.

## Epic C — The Skill Runtime (FR-30..35) · *the heart · ~4–6 days* `[P]`

Build the generic engine, then prove it by re-hosting brainstorming on it with zero regression.

- **C-1 · Skill loader & manifest (FR-30, FR-33).** Generalize `bmad-source.ts`: given a skill slug, load SKILL.md + references + merged `customize.toml` (base→team→user TOML deep-merge in TS). A build-time manifest lists installed skills/agents. *AC:* loader returns Mary's + John's resolved blocks; TOML merge matches `resolve_customization.py` on a fixture.
- **C-2 · Tool layer (FR-31).** Provider function-calls mapped to server ops: `read_reference`, `memlog_append/init/set` (→ `run_events`), `write_artifact`, `list_outputs`, `technique_query`. Plus the **no-tools structured-text fallback** for models without function-calling (the `<chips>`-style protocol). *AC:* Gemini path uses real tool calls; a fallback model drives the same ops via structured text.
- **C-3 · Checkpoint/HALT-resume state machine (FR-32).** `workflow_runs` drives run status (`running/awaiting_user/done/failed`); a HALT persists `state_json` + phase and renders a distinct "waiting on you" UI; the next user message resumes from state; stale `running` rows auto-heal (NFR-4). *This is the novel bit — build it here, behind brainstorming.* *AC:* start a run, close the tab, reopen → resumes at the same checkpoint on another device.
- **C-4 · Adapter (FR-34) + brainstorming migration (FR-35).** One documented adapter maps fs/`uv run`/composer-page mechanics to runtime equivalents; skill files stay byte-identical. Re-host v1 brainstorming entirely on the runtime. *AC:* the **parity checklist** for brainstorming passes (activation, technique flow, converge, wrap-up, artifact) with no UX regression vs. today's live app.

## Epic D — Orchestration, Agents & the Command Tree (FR-36..43) · *~4–6 days* `[P]`

- **D-1 · Subagent calls (FR-36).** Skills can spawn parallel provider calls (finalize artifact writers, editorial passes). *AC:* a wrap-up that spawns 2 writers runs them in parallel and attaches both.
- **D-2 · Background jobs (FR-37).** Upstash QStash for steps beyond Vercel's function ceiling; in-chat progress; attach on completion — *only where measured necessary*. *AC:* a long generation shows progress and completes out-of-band.
- **D-3 · Agent→command tree (FR-40, FR-41, FR-43).** Level-1 agent buttons (from installed agent skills) → level-2 that agent's commands (from its `customize.toml` menu). Mary default; all agents visible; unavailable commands greyed + honest-limits + feed builder notes. *AC:* picking John shows his commands; picking a Mary command other than brainstorming launches that skill; greyed command logs a builder note.
- **D-4 · Skill-to-skill handoff (FR-38).** A finished workflow offers chips that open a new conversation with the next agent, artifact pre-@referenced (UJ-1's Mary→John). Honor headless JSON-return contracts between skills. *AC:* finishing a brainstorm → "hand to John" chip → John opens pre-loaded with the synthesis.
- **D-5 · Second workflow to parity (product-brief) + parity harness (FR-42).** Bring **product-brief** live end-to-end as the proof that "add a skill = drop in files," and formalize the parity checklist as a reusable per-skill harness. *AC:* product-brief passes parity; adding it required no new per-skill TS beyond registry/manifest entry.
- **D-6 · Research command on free web search (FR-41).** Wire one research command to a **free/keyless** web-search provider (builder-swappable), server-side. *AC:* a research command returns cited results without a paid key.
- **D-7 · Catalog fill.** Bring remaining conversational commands to parity as capacity allows: PRD, advanced-elicitation, party-mode, PRFAQ, editorial reviews. Each is now mostly registry + parity-check, not new engine. *AC:* each added command passes its parity checklist.

---

## Permanent non-goals (out of this plan)

Code-executing dev workflows (quick-dev, dev-story, bmad-loop); user accounts/multitenancy; billing; native mobile; MCP tool shelf; autonomous outbound actions.

## Build protocol (per story)

1. Fable writes a `spec-<story>.md` (frozen intent + AC + I/O matrix), you approve.
2. Opus/Sonnet subagent implements; `npm run build` + tests green; not committed.
3. Adversarial review (Opus) → patch → verify in the running app (Playwright) → commit → auto-deploy to Vercel.

Everything ships behind the existing shared-password gate; the app stays live throughout.
