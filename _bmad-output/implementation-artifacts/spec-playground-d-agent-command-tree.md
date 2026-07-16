---
title: 'Playground v2 — Epic D: agent→command tree (all BMad agents, menus-as-chips, handoff, parity gate)'
type: 'feature'
created: '2026-07-16'
status: 'ready-for-dev'
baseline_commit: 'ab614ac'
context:
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-Playground-2026-07-16/prd.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-playground-c1-skill-loader.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-playground-c2-runtime-engine.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-playground-c4-brainstorming-migration.md'
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** Vee only reaches Mary, and only Mary's brainstorming. The whole "all of BMad in the browser" thesis needs a **navigation model**: pick any agent, then pick any of that agent's commands, and have it launch on the runtime engine — exactly like choosing an agent and a menu item in CLI BMad. C-1 already surfaces every agent + menu via `getManifest()`; C-4 proved one command (Mary→brainstorming) runs on the engine with parity. Epic D is the registry + UI + handoff layer that turns that one proven path into the full catalog.

**Approach:** A **two-level agent→command tree** (FR-40) driven entirely by `getManifest()` — no per-agent TypeScript. Level 1 = agent buttons (Mary 📊, John 📋, Winston, Sally, Paige, the CIS crew…), loaded from their skill files (icon, name, menu). Level 2 = the selected agent's menu items as command chips, straight from the merged `customize.toml` `[[agent.menu]]`. Tapping a command launches its `skill` (via `runWorkflow`) or runs its `prompt` — reusing the C-2/C-4 engine path already shipped. Each command carries a **parity status** (FR-42): green = verified on the engine; grey = renders but degrades honestly ("not available here yet — noted for the builder", FR-43) and drops a builder note. A finished workflow can offer **handoff chips** (FR-38) that launch another agent's command with the just-made artifact pre-referenced. Research commands use a **free web-search tier only** (FR-41). **Ship the tree behind `PLAYGROUND_TREE` (default off); Mary-brainstorming stays the single front door until the tree passes an in-browser pass and the flag is flipped.**

## Boundaries & Constraints

**Always:**
- **Flag-gated:** with `PLAYGROUND_TREE` unset/off, the app is byte-identical to today (Mary is the single front door, engine-brainstorming as shipped in C-4). With it on, the agent→command tree becomes the navigation model. No existing feature is lost when on — techniques, chips, doc pane, markdown, attachments, @refer, budget, notes all still work.
- **Manifest-driven, zero per-agent code (FR-40):** the tree renders from `getManifest()` / `getAgents()`. Adding, renaming, or re-menuing an agent in `.claude/skills/**` changes the tree with **no TypeScript edit**. Level 1 lists `kind:'agent'` entries (icon, name); Level 2 lists that agent's `menu` items (`code`, `description`, and exactly one of `skill`/`prompt`). Mary sorts first / is the default selection; all other agents selectable.
- **Command launch reuses the engine (FR-41):** a `skill`-backed command calls `runWorkflow({conversationId, skillSlug, ...})` — the SAME path C-4 uses for brainstorming, with the same APP_PROTOCOLS + adapter (FR-34) + persona composition, so any command inherits chips/document/honest-limits for free. A `prompt`-backed command runs the prompt text as the launch turn through the engine. **No command gets a hand-written path.** Picking an agent loads its persona (from its skill files, via C-1) as the active identity for the conversation.
- **Parity gate is data, not vibes (FR-42/FR-43):** a per-command `parity: 'verified' | 'unverified'` status lives in a small **capability registry** (a checked-in config keyed by `agent-slug` + command `code`; default `unverified`). Verified commands render active and launch. Unverified commands render **greyed** with the full breadth still visible (Vee sees everything each agent *can* do), and tapping one (a) shows the honest-degradation bubble and (b) writes a `builder_notes` row (reuse B-5 detection/outbox) so demand is captured. Brainstorming (Mary/BP) is seeded `verified` (C-4 proved it); everything else starts `unverified` until a documented in-browser pass flips it.
- **Skill-to-skill handoff (FR-38):** when a workflow finishes and emits a `<document>` artifact, the wrap-up may offer handoff chips (e.g. "Take this to John for a PRD →"). A handoff chip launches the target agent's command in the SAME conversation with the artifact pre-referenced via the existing @refer mechanism (the artifact id/title threads in as a reference). Only offer handoffs whose target command is `verified`. Honor any headless/JSON-return mode a skill defines.
- **Free web-search tier only (FR-41):** research-family commands (market/domain/technical research) that need the web use a builder-configurable free/keyless provider (env `WEB_SEARCH_PROVIDER`, default a free tier) surfaced as a runtime tool. **Never a paid search API.** If no provider is configured, the research command degrades honestly ("web search isn't wired here yet — noted for the builder") rather than failing.
- Server-only skill/manifest reads; DB-graceful (no DB → tree still renders from files, launches run single-session, builder-note capture falls back to localStorage per B-5); auth on all routes; provider budget/usage (B-2) applies to every command launch.

**Ask First:**
- Enabling the **code-executing dev-workflow family** (quick-dev / dev-story / bmad-loop) — those need the sandbox service costed as a separate phase in the PRD; keep them `unverified`/greyed here.
- Flipping `PLAYGROUND_TREE` on by default in code (the verifier flips it after an in-browser pass, same discipline as C-4's `PLAYGROUND_ENGINE`).
- Marking any command `verified` without a documented parity pass for it.

**Never:**
- No regressing the default (flag-off) Mary front door.
- No per-agent or per-command TypeScript branching — everything flows from the manifest + capability registry.
- No editing skill source files (FR-34 adapter is the only translation layer).
- No shipping an `unverified` command as active, and no silently hiding unavailable commands — greyed-but-visible is the honest-breadth contract (FR-43).
- No paid web-search API for research commands.

## I/O & Edge-Case Matrix

| Scenario | State | Expected | Error |
|---|---|---|---|
| Flag off | default | byte-identical to today (Mary front door) | N/A |
| Flag on, agent list | manifest loads | Level-1 agent buttons (Mary first), icons from files | manifest empty → Mary-only fallback + note |
| Flag on, pick agent | click John 📋 | John's persona active; his menu renders as Level-2 chips | load fail → honest error, stay on prior agent |
| Flag on, verified command | click Mary/BP | launches on engine (as C-4), chips/doc/honest-limits work | N/A |
| Flag on, unverified command | click a greyed cmd | honest "not available yet" bubble + builder_notes row | DB off → localStorage note (B-5) |
| Flag on, handoff | wrap-up doc done | chip "Take to John →" launches PRD with artifact pre-@refer'd | target unverified → handoff chip not offered |
| Research command | needs web | free-tier search tool runs; results fold into the turn | no provider → honest degrade, note captured |
| Dev-workflow command | quick-dev tapped | greyed; honest "needs a sandbox — separate phase" + note | N/A |
| Budget at 100% (billable) | any command launch | blocked honest bubble (B-2); free model still launches | N/A |
| DB off | any | tree renders, launches single-session, notes → localStorage | N/A |

</frozen-after-approval>

## Code Map

- `lib/agents/capabilities.ts` -- the **capability registry**: `parityFor(agentSlug, code) -> 'verified'|'unverified'` from a checked-in config (seed `bmad-agent-analyst`/`BP` = verified; dev-workflow family = unverified/`needs-sandbox`); `webSearchProvider()` from env
- `lib/agents/tree.ts` -- shape the manifest into the tree the UI needs: `getAgentTree()` → `[{ slug, name, icon, commands: [{ code, description, skill?, prompt?, parity }] }]`, Mary-first ordering, DB-independent
- `app/api/agents/route.ts` -- authed GET returning `getAgentTree()` (the UI fetches this like it fetches `/api/techniques`)
- `lib/runtime/launch.ts` -- `launchCommand({conversationId, agentSlug, code, provider, model})`: resolve the menu item → if `skill`, `runWorkflow(...)` with that agent's persona; if `prompt`, run prompt-as-launch-turn; unverified → honest-degrade + builder-note; reuses C-2/C-4 engine + APP_PROTOCOLS + adapter
- `lib/runtime/handoff.ts` -- given a finished run's artifact + a target command, compose the handoff chip + the pre-referenced launch (threads artifact via @refer); only for `verified` targets
- `app/api/chat/route.ts` -- accept an optional `{agentSlug, code}` launch descriptor (in addition to today's technique launch); route through `lib/runtime/launch.ts` when `PLAYGROUND_TREE` on; unchanged otherwise
- `lib/runtime/tools.ts` -- add a `web_search` tool (free-tier provider) available to research-family skills; no-op-note when unconfigured
- `components/AgentTree.tsx` (new) -- two-level tree: Level-1 agent row (Mary default-selected), Level-2 command chips with verified/greyed states; greyed chips fire the honest-degrade + note path; slots beside the existing technique row in `ChatPane`
- `components/ChatPane.tsx` -- mount `AgentTree` behind `PLAYGROUND_TREE`; on verified-command click, launch via the chat route's new descriptor; render handoff chips from a finished wrap-up; technique row stays as-is for Mary/brainstorming
- `README.md` / `.env.example` -- `PLAYGROUND_TREE`, `WEB_SEARCH_PROVIDER`
- tests -- tree shaping from a fixture manifest (Mary-first, menu→commands, parity join); capability registry lookups + seed; launch descriptor routes skill vs prompt vs unverified; handoff only for verified targets + artifact pre-reference; flag-off == today (snapshot); DB-off graceful

## Tasks & Acceptance

**Execution:**
- [ ] `lib/agents/capabilities.ts` -- capability registry + seed (BP verified; dev family needs-sandbox) + web-search provider env
- [ ] `lib/agents/tree.ts` -- `getAgentTree()` manifest→tree, Mary-first, parity join
- [ ] `app/api/agents/route.ts` -- authed GET
- [ ] `lib/runtime/launch.ts` -- `launchCommand` (skill/prompt/unverified) on the engine
- [ ] `lib/runtime/handoff.ts` -- verified-only handoff chips + artifact pre-reference
- [ ] `lib/runtime/tools.ts` -- free-tier `web_search` tool (degrade-when-unconfigured)
- [ ] `app/api/chat/route.ts` -- launch-descriptor routing behind `PLAYGROUND_TREE`
- [ ] `components/AgentTree.tsx` + `components/ChatPane.tsx` -- two-level tree, greyed states, handoff chips, flag mount
- [ ] `README.md` / `.env.example` -- flags
- [ ] tests -- tree shape, capability lookup, launch routing, handoff gating, flag-off snapshot, DB-off

**Acceptance Criteria:**
- Given `PLAYGROUND_TREE` off, the app is byte-identical to today (Mary front door; C-4 engine-brainstorming).
- Given it on, Level 1 shows every `kind:'agent'` from the manifest (Mary first, icons from files) and picking an agent loads its persona + renders its menu as Level-2 command chips — with **no per-agent code**.
- Given a `verified` command (Mary/BP), tapping it launches on the runtime engine with chips/document/honest-limits/markdown/attachments/@refer/budget all intact (inherits C-4).
- Given an `unverified` command, it renders **greyed but visible**, and tapping it shows an honest "not available here yet" bubble and records a builder note (server-side, or localStorage when DB off).
- Given a finished workflow with an artifact, a handoff chip launches a **verified** target command in the same conversation with the artifact pre-referenced; unverified targets offer no handoff.
- Given a research command with no configured free provider, it degrades honestly and captures a note — never calls a paid API.
- `npm run build` clean; `npm test` green; the default path unregressed; a written per-command parity note accompanies any command flipped to `verified`.

## Design Notes

**The registry is where breadth meets honesty.** The manifest gives *breadth* (every agent, every command, always visible — FR-43); the capability registry gives *honesty* (only parity-passed commands are active — FR-42). Keeping parity as checked-in data (not code) means flipping a command live = one config edit + a documented pass, and Vee always sees the full map of what BMad can do even before each piece is wired.

**Launch is thin because C-2/C-4 did the work.** `launchCommand` is mostly a resolver: manifest menu item → `runWorkflow` with the right skill + persona. The engine, APP_PROTOCOLS, adapter (FR-34), chips, document, checkpoint/HALT-resume already exist. This is why Epic D is "mostly registry work" (C-4 design note) — the hard runtime is done.

**Handoff = the UJ-1 Mary→John moment.** It's the most visceral proof that structure beats a single ChatGPT thread: brainstorm with Mary, then one chip carries the artifact into John's PRD with context intact. Keep it artifact-anchored and verified-only so it never hands off into a dead (greyed) command.

**Dev-workflow family stays out.** quick-dev/dev-story/bmad-loop execute code and need the sandbox phase the PRD costs separately — they appear greyed with a specific "needs a sandbox (separate phase)" degrade, so their breadth shows without pretending they run.

**Sequencing after this ships:** parity-check agent-by-agent — Mary's remaining menu (MR/DR/TR/CB/WB/DP) first, then John's, then the rest (FR-41 ordering) — flipping each command to `verified` as its documented in-browser pass passes. The tree opens up incrementally; the flag flips to default-on once enough of Mary's set is green to feel like "all of BMad."

## Verification

`npm run build` clean · `npm test` green · **In-browser pass (flag on): agent switch loads persona + menu; a verified command launches on the engine with full parity; a greyed command degrades honestly and logs a note; a wrap-up handoff carries an artifact into a verified target** — documented per-command. Default (flag off) unchanged.
