---
title: 'Playground v2 — Epic C-2+C-3: runtime engine (tool loop + checkpoint/HALT-resume)'
type: 'feature'
created: '2026-07-16'
status: 'ready-for-dev'
baseline_commit: '72ed180'
context:
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-Playground-2026-07-16/prd.md'
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-Playground-2026-07-16/addendum.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-playground-c1-skill-loader.md'
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** A BMad skill is a multi-step, tool-using, human-checkpointing workflow. The current chat is single-shot with no tools and no pause-for-human. To run real skills we need an engine: an agentic tool loop that can pause at a HALT and resume across sessions.

**Approach:** Build a **runtime engine** module — (a) an agentic tool loop exposing server ops as provider function-calls (with a structured-text fallback for tool-less models), and (b) a checkpoint/HALT state machine backed by `workflow_runs` (`running | awaiting_user | done | failed`) that persists loop state and resumes on the next user message, across devices. **Build it as an engine + tests; do NOT wire it into the live chat route yet** — the live Mary chat must stay byte-identical. C-4 migrates brainstorming onto this engine.

## Boundaries & Constraints

**Always:**
- **Tool loop:** given a system prompt + history + a tool set, run: model → (tool calls) → execute server-side → feed results back → repeat until the model produces a final user-facing turn or a HALT. Streaming: user-facing assistant text streams as it's produced; tool-call rounds surface as lightweight progress ("Mary is reading the technique catalog…"). Cap iterations (e.g. 12) with a safe stop.
- **Tools (FR-31), each a pure server op with a JSON schema:** `read_reference(skill, name)`, `memlog_init/append/set` (→ `run_events` rows, same entry types as CLI memlog), `write_artifact(title, markdown)` (→ `artifacts` version), `list_outputs(conversationId)`, `technique_query(kind, args)` (brain-methods catalog: list/random/show), and `request_checkpoint(prompt)` (the HALT — see below). Tools are declared to Gemini (`functionDeclarations`/`function_call`) and OpenRouter (`tools`/`tool_calls`). Keep tool implementations small, injectable/testable, and DB-graceful (no DB → memlog/artifact tools no-op-return a note).
- **Structured-text fallback (tool-less models):** when the provider/model lacks reliable function-calling, the engine drives the same ops via a `<tool name="..." args="{...}">` sentinel protocol (same idea as `<chips>`/`<document>`): the model emits a tool tag, the engine parses, executes, and re-prompts with the result. One code path chooses native-tools vs structured-text by capability.
- **Checkpoint / HALT-resume (FR-32, the novel core):** `request_checkpoint(prompt)` (or a HALT signal in the workflow) sets `workflow_runs.status='awaiting_user'`, persists `state_json` (phase, accumulated context/loop state, the pending prompt) + the run's `run_events`, and returns control to the UI with a distinct "waiting on you" payload. The next user message for that run loads `state_json` and resumes the loop from where it paused. Runs are keyed to a conversation; resumable across sessions/devices. Stale `running` rows older than N minutes auto-flip to `awaiting_user` with an apology (NFR-4). Everything a resume needs is in Neon (`workflow_runs` + `run_events`), never only in memory.
- **Engine API (clean seam):** something like `runWorkflow({conversationId, skillSlug, input, provider, model, resumeRunId?}) -> stream + terminal state`. Deterministic and unit-testable with a mock provider + mock tool executors. Uses C-1's `loadSkill`/`adaptMechanics` for skill text.
- Server-only. DB-graceful. Do NOT modify the live `app/api/chat/route.ts` behavior — add the engine behind a new internal entry (e.g. `lib/runtime/*` + optionally an unused `/api/run` route guarded so it doesn't affect Mary). The existing chat/brainstorming path is untouched until C-4.

**Ask First:**
- Wiring the engine into the live Mary chat (that's C-4, needs the parity checklist).
- Any provider/model capability assumption that would change the live default.

**Never:**
- No regression to the live app (Mary chat, markdown, attachments, @refer, budget, notes) — this story adds an unused engine.
- No losing resumability to in-memory-only state.
- No executing code / shell / arbitrary tools — the tool set is the fixed BMad-op list above.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Tool round | model emits tool_call | server executes, result fed back, loop continues | unknown tool → error result, loop continues/stops safely |
| Final turn | model produces user text | stream it, run status per phase | N/A |
| HALT | request_checkpoint | status=awaiting_user, state_json persisted, "waiting" payload | DB off → in-memory single-session fallback + note |
| Resume | next msg for awaiting_user run | loads state_json, continues from checkpoint | run missing → new run |
| Cross-device resume | reopen elsewhere | same awaiting_user run resumes | N/A |
| Tool-less model | no function-calling | structured-text `<tool>` protocol drives same ops | malformed tag → ignored, re-prompt |
| Iteration cap | runaway tool loop | safe stop with honest message | N/A |
| Stale running row | crashed mid-loop | auto-flips to awaiting_user with apology | N/A |
| DB off | any | engine runs single-session, memlog/artifact tools no-op-note, no crash | N/A |

</frozen-after-approval>

## Code Map

- `lib/runtime/tools.ts` -- tool definitions (JSON schema) + server implementations (injectable), incl. `request_checkpoint`
- `lib/runtime/loop.ts` -- the agentic loop (native tools + structured-text fallback), iteration cap, streaming/progress events
- `lib/runtime/state.ts` -- `workflow_runs` state machine: create/persist/resume, `state_json`, stale-run heal
- `lib/repo/workflow-runs.ts` + `lib/repo/run-events.ts` -- CRUD (tables already exist)
- `lib/llm.ts` -- add native tool-calling to Gemini + OpenRouter streamers (functionDeclarations / tools); capability flag for fallback
- `app/api/run/route.ts` -- (optional, guarded/unused-by-live-UI) authed entry to exercise the engine; must not affect Mary
- tests -- loop with mock provider (tool round → result → final), checkpoint persist+resume (incl. cross-session via state_json), structured-text fallback parse, stale-run heal, DB-off graceful, iteration cap

## Tasks & Acceptance

**Execution:**
- [ ] `lib/repo/workflow-runs.ts` + `lib/repo/run-events.ts` -- CRUD
- [ ] `lib/runtime/tools.ts` -- tool schemas + implementations (+ request_checkpoint)
- [ ] `lib/llm.ts` -- native function-calling for both providers + capability flag
- [ ] `lib/runtime/loop.ts` -- agentic loop + structured-text fallback + iteration cap
- [ ] `lib/runtime/state.ts` -- checkpoint persist/resume + stale heal
- [ ] `app/api/run/route.ts` -- guarded engine entry (not used by live UI)
- [ ] tests -- loop, checkpoint resume, fallback, stale heal, DB-off, cap

**Acceptance Criteria:**
- Given a mock provider that emits a tool call then final text, when the loop runs, then the tool executes server-side, its result is fed back, and the final text streams.
- Given a workflow that HALTs, when it checkpoints, then `workflow_runs.status='awaiting_user'` with `state_json` persisted; and a fresh engine invocation with the next user message resumes from that state (proving cross-session resume via DB, not memory).
- Given a tool-less model, then the same ops run via the `<tool>` structured-text protocol.
- Given a stale `running` row, then it auto-heals to `awaiting_user`.
- Given no DATABASE_URL, the engine still runs single-session without crashing (persistence tools no-op-note).
- The LIVE app is unchanged: `npm run build` clean, `npm test` green, Mary chat/markdown/attachments/@refer/budget/notes all behave exactly as before (the engine is not on the live path).

## Design Notes

**HALT = a tool, not an exception.** Modeling the checkpoint as `request_checkpoint(prompt)` keeps the loop uniform: the model "calls" it, the engine persists + returns the waiting payload. Resume = re-enter the loop with the persisted `state_json` and the user's answer appended as the tool's "result"/next turn.

**state_json contents:** phase marker, the running message/context stack (or enough to reconstruct it), pending checkpoint prompt, skill slug, provider/model. Keep it bounded; prefer reconstructing context from `run_events` + conversation messages over storing giant blobs.

**Capability flag:** reuse/extend the multimodal capability approach — a per-provider/model "supports function-calling" hint (Gemini yes; OpenRouter via allowlist/env), else structured-text fallback.

## Verification

`npm run build` clean · `npm test` green (engine unit tests + all prior) · Live app behavior-unchanged (Mary chat still works identically — the engine ships dormant).
