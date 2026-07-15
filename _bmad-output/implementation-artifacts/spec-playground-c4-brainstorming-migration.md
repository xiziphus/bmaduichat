---
title: 'Playground v2 — Epic C-4: migrate brainstorming onto the runtime engine (parity, flag-gated)'
type: 'feature'
created: '2026-07-16'
status: 'ready-for-dev'
baseline_commit: 'f9244ee'
context:
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-Playground-2026-07-16/prd.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-playground-c2-runtime-engine.md'
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** The engine is dormant. Its acceptance test is: run the REAL `bmad-brainstorming` SKILL.md through it and match today's hardcoded Mary experience (FR-35, the parity proof) — without regressing the live app.

**Approach:** Register `bmad-brainstorming` as a runtime skill; compose its runtime prompt as `adaptMechanics(SKILL.md + active references)` PLUS the app-protocol addenda (chips, `<document>`, honest-limits, attachments-note) currently in `lib/mary.ts`. Route the Mary brainstorming chat through `runWorkflow` **only when `PLAYGROUND_ENGINE` is on**; the hardcoded path stays the DEFAULT until parity is verified and the flag is flipped. Keep technique buttons, chips, doc pane, markdown, attachments all working on the engine path.

## Boundaries & Constraints

**Always:**
- **Flag-gated:** with `PLAYGROUND_ENGINE` unset/off, the live app is byte-identical to today (hardcoded Mary). With it on, the same conversation runs through the engine. No user-visible feature is lost when on.
- **Prompt composition (the adapter, FR-34):** runtime brainstorming prompt = `adaptMechanics(loadSkill('bmad-brainstorming').skillMd + the reference(s) for the active phase)` + the **app-protocol block** (the chips protocol, `<document>` protocol, honest-limits, attachments note — extract these from `lib/mary.ts` into a shared `APP_PROTOCOLS` so both the hardcoded Mary and the runtime use the exact same protocol text). Mary's persona/framing/stance now come from the loaded agent + skill files via C-1, not the hand-written copy.
- **Technique buttons on the engine path:** clicking a technique still works — it injects the launch as the user turn (as today) and/or drives the engine's `technique_query` tool; the 2-random + 🎲 UI is unchanged. Chips still render and are clickable. A wrap-up still emits `<document>` → artifact in the doc pane.
- **Parity checklist (FR-42) — the acceptance gate.** Verify on the engine path: (1) activation/greeting in Mary's voice; (2) technique launch opens the technique with a question (facilitates, doesn't lecture); (3) chips appear every turn; (4) converge offered when a batch is spent; (5) wrap-up produces a formatted document artifact; (6) honest-limits when asked for something out of reach; (7) markdown + attachments + @refer + budget still work. A documented checklist result (pass/fail per item) is part of done.
- **Do NOT flip the default in code.** Ship with hardcoded as default. The human/verifier flips `PLAYGROUND_ENGINE` after parity holds. (Fable will verify in-browser and decide.)
- DB-graceful; auth intact; provider budget/usage still apply on the engine path.

**Ask First:**
- Removing the hardcoded `lib/mary.ts` path (keep it as the safe default this story).
- Any change that alters the hardcoded path's output.

**Never:**
- No regressing the default (hardcoded) experience.
- No dropping chips/document/markdown/attachments on the engine path — parity means *everything* still works.

## I/O & Edge-Case Matrix

| Scenario | State | Expected | Error |
|---|---|---|---|
| Flag off | default | byte-identical to today (hardcoded Mary) | N/A |
| Flag on, greet | new convo | Mary greets in-voice from loaded files | load fail → honest error, fall back to hardcoded |
| Flag on, technique | click JTBD | engine opens the technique with a question | N/A |
| Flag on, chips | every reply | chips render + clickable | missing → no chips, no crash |
| Flag on, wrap-up | converge/finish | `<document>` → artifact in doc pane | N/A |
| Flag on, honest limits | "browse the web" | says it can't + "noted for the builder" | N/A |
| Flag on, attachments/@refer | image / @ref | still work through the engine | N/A |
| Provider rate-limited | Gemini 429 | honest bubble (as today); try free model | N/A |

</frozen-after-approval>

## Code Map

- `lib/mary.ts` -- extract chips/document/honest-limits/attachments into exported `APP_PROTOCOLS`; hardcoded path keeps using them (output unchanged)
- `lib/runtime/brainstorming.ts` -- compose the brainstorming runtime prompt: loaded skill text (adapted) + `APP_PROTOCOLS`; phase→reference selection
- `lib/runtime/engine.ts` / `loop.ts` -- ensure engine output carries chips + `<document>` through to the client stream (same SSE shape the client already parses)
- `app/api/chat/route.ts` -- when `PLAYGROUND_ENGINE` on, route brainstorming through `runWorkflow` (resume active run if any); else the existing path. Keep usage/budget/notes/attachments wiring.
- `components/ChatPane.tsx` -- handle an `awaiting_user` (checkpoint) render state if the engine HALTs (light "Mary is waiting on you" affordance); technique buttons unchanged
- `README.md` -- document `PLAYGROUND_ENGINE`
- tests -- prompt composition includes APP_PROTOCOLS + adapted skill text; engine-path chips/document surface; flag-off equals hardcoded (snapshot)

## Tasks & Acceptance

**Execution:**
- [ ] `lib/mary.ts` -- extract `APP_PROTOCOLS` (hardcoded output byte-unchanged)
- [ ] `lib/runtime/brainstorming.ts` -- runtime prompt composition + phase references
- [ ] engine/loop -- carry chips + `<document>` to the client stream
- [ ] `app/api/chat/route.ts` -- flag-gated engine routing (default hardcoded)
- [ ] `components/ChatPane.tsx` -- checkpoint/awaiting_user affordance
- [ ] `README.md` -- PLAYGROUND_ENGINE
- [ ] tests -- composition, engine-path chips/document, flag-off==hardcoded

**Acceptance Criteria:**
- Given `PLAYGROUND_ENGINE` off, the app is byte-identical to today (snapshot/behavior).
- Given it on, a brainstorm greets in Mary's voice, techniques open with a question, chips appear, converge is offered, wrap-up yields a document artifact, honest-limits hold — all from the loaded SKILL.md + APP_PROTOCOLS (not hand-written Mary).
- Given it on, markdown, attachments, @refer, and budget still work.
- `npm run build` clean; `npm test` green; the default path unregressed.
- A written parity-checklist result (7 items) accompanies the change.

## Design Notes

**This is the CLI-fidelity payoff:** engine-Mary = the actual brainstorming SKILL.md executed, with only the app-protocol layer added by one documented adapter. If engine-Mary is as good as hardcoded-Mary, the whole "all of BMad" thesis is proven and Epic D is mostly registry work.

**Keep the flag default OFF** — the verifier flips it after an in-browser parity pass; provider rate limits may require using the free model for that pass.

## Verification

`npm run build` clean · `npm test` green · **In-browser parity pass on the engine path (flag on): greeting, technique, chips, converge, wrap-up document, honest-limits, markdown/attachments/@refer** — documented pass/fail. Default (flag off) unchanged.
