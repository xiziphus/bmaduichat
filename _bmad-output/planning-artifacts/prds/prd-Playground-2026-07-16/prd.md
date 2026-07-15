---
title: "Playground v2 — Full BMad Runtime in the Browser — PRD"
status: final
created: 2026-07-16
updated: 2026-07-16
---

# Playground v2 — Full BMad Runtime in the Browser

## Executive Summary

Playground v1 (live at bmaduichat.vercel.app) proved the wedge: a CLI-averse consultant ("Vee") can brainstorm with a real BMad agent in a friendly browser chat, and the agent runs on BMad's *actual source text*, not a paraphrase. v2 finishes the thought: **the entire conversational BMad method — every agent, every planning/document workflow — running stateful in the browser.**

The product bet is unchanged from the v1 brief: frameworks beat freeform ChatGPT, agents are teachable (including their limits), and a session should end with something you can hold. v2 adds the missing halves: **memory** (conversations, artifacts, and in-flight workflow runs persist in Neon) and **breadth** (a generic skill runtime that executes BMad SKILL.md files as data, so adding a skill means dropping in its files — not writing code).

Explicitly and permanently out: the code-*executing* dev-workflow family. Playground is a thinking tool, not an IDE.

## Goals & Success Criteria

1. **Deliver the whole method, not one skill.** Vee can complete a real BMad chain — e.g. brainstorm with Mary → product brief with John → PRD — entirely in the browser, with each artifact feeding the next.
2. **Statefulness.** Nothing is lost on refresh: conversations, documents, technique runs, and half-finished workflows all resume.
3. **Zero-code extensibility (CLI-fidelity, industrialized).** The builder adds/updates a BMad skill or agent by adding its files to the repo; the runtime picks it up. No per-skill TypeScript.
4. **Success metric (inherited, in spirit):** ~10 genuine uses by Vee, of which at least 2 produce an artifact she keeps or sends onward. Counter-metrics below guard the soul of the thing.

### Counter-metrics (what we refuse to optimize)

- **No retention machinery** — no streaks, no notifications. It's a tool, not a habit product.
- **No method dilution** — a workflow that "works" but skips BMad's actual phases (converge, wrap-up, checkpoints) counts as a failure even if the chat feels nice. The parity checklist (FR-42) is the guard.
- **No cost creep** — monthly provider spend above the configured cap is a bug, not growth.

## Users

Two, by design (shared password; no accounts in v2):

- **Vee** — the consumer. Everything she touches must stay disarming: chat, chips, documents. She never sees the runtime.
- **The builder** — operator/admin. Sees the builder outbox, budget meter, and workflow-run internals when needed.

## User Journey (UJ-1 — the chain that defines v2)

Vee opens Playground on her laptop. Her sidebar shows last week's *"retreat de-risk plan"* conversation with its two artifacts nested under it. She starts a new conversation; the agent picker offers Mary 📊, John 📋, and the others. She picks Mary, runs a 20-minute brainstorm (techniques as buttons, as today), and at wrap-up Mary offers **converge → wrap-up**; the synthesis lands as a **document in the doc pane**, saved under the conversation. A chip appears: *"This could become a product brief — hand it to John?"* She taps it. A new conversation opens with John, **pre-loaded with the brainstorm artifact via @reference**; John's workflow runs its own phases (discovery → draft → checkpoint), pausing with a highlighted **"John is waiting on you"** state when it needs her input — even if she closed the tab and comes back Thursday. The finished brief renders formatted in the doc pane with export/PDF. Two artifacts, two agents, one method chain — no CLI, nothing lost.

## Functional Requirements

### F1 · Statefulness & persistence (was "goal 2") — *build first*

- **FR-1** Conversations and messages persist in Neon; the sidebar lists them; reopening resumes exactly.
- **FR-2** Artifacts (documents) are first-class rows: belong to a conversation, versioned on each regeneration, rendered in the doc pane.
- **FR-3** The doc pane renders live, well-formatted markdown (the v1 mock's typographic quality) and updates as the agent writes.
- **FR-4** Export: copy-markdown and PDF `[ASSUMPTION: print-CSS PDF, no server rendering lib]`; artifacts also reachable at a stable authed URL.
- **FR-5** "New conversation" archives, never destroys.

### F2 · Conversations UX (was "goal 3")

- **FR-10** Rename conversations inline.
- **FR-11** `@` autocomplete referencing any conversation or artifact; referenced content is injected as context for the agent.
- **FR-12** Agents may read other conversations/artifacts when relevant (single-tenant, so scope-safe) and must cite what they used ("I read @travel-pitch").

### F3 · Guardrails & builder loop (was "goal 4")

- **FR-20** Monthly budget cap enforced app-side (default $10): token accounting per request, warning at 80%, hard stop with honest message at 100%. Free-tier OpenRouter never blocks.
- **FR-21** Builder notes move server-side: "noted for the builder" events write to a Neon ledger with conversation context; the 📮 drawer reads from it.
- **FR-22** Consent outbox: Vee reviews collected notes and explicitly sends them to the builder `[ASSUMPTION: "send" = flag rows builder-visible; no email in v2]`.

### F4 · The skill runtime (the heart of v2)

- **FR-30** A runtime that loads any BMad skill's SKILL.md + references from the repo **at request time** and executes it as the agent's instructions (the v1 `bmad-source.ts` pattern, generalized).
- **FR-31** Tool layer replacing CLI mechanics, exposed to the model as provider function-calls: read-reference-file, memlog append/init/set (→ Neon), resolve-customization (TOML merge in TS), technique-catalog queries (brain.py equivalents), write-artifact, list/read prior outputs.
- **FR-32** **Checkpoint/HALT-resume:** a workflow run is a Neon state machine (`running / awaiting-user / done`); a HALT renders as a visually distinct waiting state; runs resume across sessions/devices.
- **FR-33** Config resolution honors BMad's file order (base → team → user TOML) with identical merge semantics.
- **FR-34** Adapted-mechanics policy: filesystem paths, `uv run` invocations, and composer-page references are mapped to runtime equivalents by ONE documented adapter — never by editing skill source. Skill files remain byte-identical to CLI BMad.
- **FR-35** The v1 hardcoded brainstorming implementation is **re-hosted on the runtime** and must pass the parity checklist before any new skill ships (the migration is the runtime's acceptance test).

### F5 · Orchestration

- **FR-36** Skills can spawn subagent calls (e.g. finalize's artifact writers, editorial passes); parallel where the skill says so.
- **FR-37** Long generations run as background jobs (Upstash QStash) with progress visible in-chat; results attach on completion `[ASSUMPTION: QStash enters only when a step exceeds Vercel's function ceiling — measure first]`.
- **FR-38** Skill-to-skill handoff: a finished workflow can offer chips that launch another skill with selected artifacts pre-referenced (UJ-1's Mary→John moment). Headless JSON-return modes are honored where skills define them.

### F6 · Agents & command tree

- **FR-40** **Two-level agent→command tree** (this is how Vee reaches everything). Level 1: choose an **agent** — buttons for Mary 📊, John 📋, Winston, Sally, Paige, the CIS crew… — each loaded from its skill files (icon, identity, principles, menu). Level 2: that agent's **custom commands** as buttons — the agent's menu items from its `customize.toml`. Mary is the default/first agent, but any agent is selectable, exactly like picking an agent in CLI BMad.
- **FR-41** **Every agent command maps to a skill/workflow — agents do far more than one thing.** Mary's commands are her full menu: brainstorming (BP), market research (MR), domain research (DR), technical research (TR), product brief (CB), Working-Backwards PRFAQ (WB), document-project (DP). The launch catalog is therefore organized **by agent**, parity-checked agent-by-agent (Mary's set first, then John's, then the rest). Research commands use a **free web-search tier only** (builder-configurable; default a keyless/free-tier provider — never a paid search API).
- **FR-42** **Parity checklist per command** (the CLI-fidelity contract): correct activation/greeting, phases and checkpoints in order, artifacts produced to spec, honest degradation where a mechanic doesn't exist. A command that fails parity doesn't ship as "working" — it appears in the tree but greyed, degrading honestly ("this one isn't available here yet — noted for the builder").
- **FR-43** Greyed/unavailable commands still render in the tree (so Vee sees the full breadth of what each agent *can* do) and feed the builder-notes ledger (FR-21) when tapped.

## Non-Functional Requirements

- **NFR-1 Cost:** default free-tier OpenRouter; Gemini for quality moments; full-skill prompts are large, so a context budget per provider is enforced (prompt assembly warns, then truncates references before it ever truncates persona) `[ASSUMPTION: models with function-calling required — constrain OPENROUTER_MODEL choices accordingly]`.
- **NFR-2 Latency:** first streamed token < ~3s on warm paths; background jobs show progress within 5s.
- **NFR-3 Fidelity:** skill text verbatim from repo files; the adapter (FR-34) is the only translation layer; parity failures are release blockers per FR-42.
- **NFR-4 Resilience:** any interrupted run resumes from its last checkpoint; no orphaned "running" rows (stale runs auto-flip to awaiting-user with an apology).
- **NFR-5 Security:** keys server-side only; artifact HTML rendered in sandboxed iframes with strict CSP; cookie auth on every route; Vee's data never leaves Neon except to the chosen LLM provider.
- **NFR-6 Observability:** every workflow run has a memlog-equivalent audit trail readable by the builder.

## Scope

### In (v2)

Phased per the sequencing decision — **A:** F1 (persistence/doc) → **B:** F2+F3 (conversations UX, guardrails) → **C:** F4 (runtime + brainstorming migration) → **D:** F5+F6 (orchestration, agents, catalog).

### Out (permanent non-goals)

- **Code-executing dev workflows** (quick-dev, dev-story, bmad-loop, executing code-review) — Playground is a thinking tool; no sandbox, ever.
- User accounts / multi-tenancy; billing; mobile apps (responsive web only); MCP tool shelf (future consideration, not v2); autonomous outbound actions (email etc.).

## Risks & Mitigations

1. **Checkpoint-over-HTTP is the novel engineering** — mitigate by building it in phase C behind the brainstorming migration (a known-good workflow) before any new skill uses it.
2. **Prompt size vs. model context/cost** — full SKILL.md + references can be tens of KB; mitigate with per-phase reference loading (skills already load references just-in-time — mirror that) and NFR-1's budget.
3. **Free-model quality** — facilitation quality varies wildly on free OpenRouter models; mitigate: a per-skill "minimum model tier" hint the builder can set in env.
4. **Goals-first rework (accepted)** — F1–F3 build on the current hardcoded chat; the runtime later absorbs them. Contained by keeping F1's schema runtime-shaped from day one (the `workflow_runs` table is designed in phase A, used in phase C).
5. **Provider function-calling variance** — the tool layer (FR-31) needs reliable tool calls; Gemini is solid, OpenRouter models vary. Mitigate per NFR-1 model constraints + a no-tools fallback mode (structured-text protocol, like v1's `<chips>`).

## Open Questions

- PDF: is print-CSS good enough for "send to client," or is a rendering lib warranted? (Phase A decision.)
- Party-mode's multi-persona turns: one model call per persona vs one orchestrated call — cost/quality tradeoff. (Phase D.)

## Resolved (user decisions)

- **Web search = free only.** Research commands default to a keyless/free-tier provider, builder-swappable; no paid search API. (Closes the provider question.)
- **Agent→command tree ships as the navigation model** (FR-40). Mary is the default agent and the current single front door; the tree opens up agent-by-agent as each agent's commands pass parity. Vee always sees the full tree (greyed where not yet available).
