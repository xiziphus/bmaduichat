# Addendum — Playground v2 PRD

Technical depth and rejected alternatives for downstream consumers (architecture, epics & stories). Not requirements — context.

## CLI mechanic → browser equivalent (the FR-34 adapter map)

| CLI BMad mechanic | Browser runtime equivalent |
|---|---|
| Read SKILL.md / references from disk | `bmad-source`-style repo reads at request time (Vercel `outputFileTracingIncludes` per skill glob) |
| `memlog.py init/append/set` | `memlog` service → Neon `run_events` table (append-only, same entry types) |
| `resolve_customization.py` | TS TOML deep-merge (same rules: scalars override, keyed arrays replace/append, arrays append) |
| `brain.py list/random/show/html` | catalog service over `brain-methods.csv` (v1 already parses it); composer page → in-app technique picker |
| `{doc_workspace}` folders + artifact files | `artifacts` rows keyed by conversation + workflow run |
| Subagent spawning | parallel provider calls server-side; long ones via QStash job + progress events |
| HALT / checkpoint (wait for human) | `workflow_runs.status = awaiting_user` + UI waiting state; resume on next user message |
| `open` browser/editor | render in doc pane / artifact URL |
| Headless JSON returns | internal skill-to-skill invocation contract (FR-38) |

## Schema sketch (phase A, designed runtime-shaped)

- `conversations` (id, title, agent_slug, created, archived)
- `messages` (id, conversation_id, role, content, chips_json, created)
- `artifacts` (id, conversation_id, run_id?, title, kind, markdown, html?, version, created)
- `workflow_runs` (id, conversation_id, skill_slug, status: running|awaiting_user|done|failed, phase, state_json, created, updated)
- `run_events` (id, run_id, type: idea|decision|question|technique|event|…, text, by, created) — the memlog
- `builder_notes` (id, conversation_id, excerpt, status: collected|sent, created)
- `usage` (id, provider, model, tokens_in, tokens_out, cost_est, created) — feeds FR-20

## Phase → effort (solo, focused days; calendar ≈ ×2 at spurts pace)

| Phase | Contents | Focused days |
|---|---|---|
| A | F1 persistence + doc pane + export | 1.5–2 |
| B | F2 conversations UX + F3 guardrails/outbox | 1.5–2 |
| C | F4 runtime + tool layer + checkpoint machine + brainstorming migration (parity) | 4–6 |
| D | F5 orchestration + F6 agents & catalog (~8 skills parity-checked) + web search | 4–6 |
| **Total** | | **~11–16 focused days (≈3 wks)** |

## Rejected alternatives (logged decisions)

- **Runtime-first sequencing** — rejected by user for goals-first (faster visible wins for Vee); rework contained via runtime-shaped schema in phase A.
- **Real user accounts in v2** — rejected; 2-person shared password stands.
- **Code-execution sandbox (E2B/Modal) for dev workflows** — rejected permanently; Playground is a thinking tool.
- **Anthropic provider** — excluded in v1 spec by user (Gemini + OpenRouter only); unchanged for v2.
- **Copying skill text into TS constants** — superseded in v1 by runtime file reads; v2 hard-requires the file-read pattern (FR-30/34).

## Provider notes (for architecture)

- Tool layer requires function-calling: Gemini native; OpenRouter varies by model — enforce a function-calling-capable default and a documented `<tool>`-style structured-text fallback (proven pattern: v1 chips).
- Context budgeting: measure real skill+references sizes (brainstorming ≈ 12KB SKILL + 4–8KB active reference); per-phase reference loading keeps prompts bounded — mirrors the CLI's just-in-time reference loads.
