---
title: 'Playground v1 — Goal 1: Walking Skeleton (auth + Mary chat + techniques)'
type: 'feature'
created: '2026-07-14'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'e1f27de1576efc95b9b2c20ab1c0626fdc878dc5'
context:
  - '{project-root}/_bmad-output/planning-artifacts/briefs/brief-Playground-2026-07-13/brief.md'
  - '{project-root}/_bmad-output/design-mocks/playground-final-mock.html'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Playground (the no-CLI browser app delivering BMad brainstorming per the product brief) has zero code. Nothing exists to deploy, chat with, or build goals 2–4 on.

**Approach:** Scaffold a Vercel-deployable Next.js (App Router, TypeScript) app at the repo root: shared-password gate → three-pane UI matching the D×F composite mock → streaming chat with "Mary" who runs brainstorming techniques (2 random surfaced + cycle button), suggests next moves as dynamic command chips, and is honest about missing capabilities. LLM backend is **provider-switchable from the UI**: Gemini (budgeted) or OpenRouter (free model, unlimited). Single-user throwaway-grade: no database this slice — conversation history lives in client state; persistence is goal 2.

## Boundaries & Constraints

**Always:**
- Visual language follows `playground-final-mock.html` (CSS variables, pastel D×F skin, resizable gutters, Fraunces/Nunito/Newsreader fonts).
- Mary's facilitation mirrors the BMad brainstorming skill's spirit (per `bmad-source-bundle.md`): one prompt per message, reframe & push back, shift technique when spent — encoded in the system prompt.
- LLM access via a thin provider adapter with two implementations: **Gemini** (`GEMINI_API_KEY` + `GEMINI_MODEL` env, default `gemini-2.5-flash`) and **OpenRouter** (`OPENROUTER_API_KEY` + `OPENROUTER_MODEL` env, default a free-tier model). Model names are env-configurable for BOTH providers — never hardcoded. Provider is chosen per-request by a UI toggle; both stream. Keys only ever server-side (Vercel env vars).
- Honest-limits behavior: system prompt instructs Mary to say plainly when asked for something the app can't do (browse, files, persistence) and label it "noted for the builder".
- Every route except `/login` and `/api/auth` requires the auth cookie.

**Ask First:**
- Adding any database, ORM, or external service beyond the two LLM providers.
- Changing the 8-technique pool (listed in Design Notes).
- Any paid dependency or Vercel configuration beyond env vars.

**Never:**
- No Anthropic/Claude dependency in this app.
- No Neon/Upstash wiring, no artifact/doc generation, no export/PDF, no rename/@refer (goals 2–4).
- No code execution, no MCP, no multitenant/user accounts.
- No UI framework beyond React + plain CSS (no Tailwind/component libraries) — the mock's CSS is the design system.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Login OK | correct password at `/login` | httpOnly cookie set; redirect `/` | N/A |
| Login bad | wrong password | stay on `/login`, friendly error, no cookie | 401 |
| Unauthed access | GET `/` without cookie | redirect to `/login` | N/A |
| Chat happy path | POST `/api/chat` {messages[], provider, technique?} | SSE stream of Mary tokens; trailing chips block parsed out of visible text | N/A |
| Provider toggle | switch UI toggle Gemini↔OpenRouter mid-conversation | next request uses the selected provider; history carries over unchanged | N/A |
| Technique surface | load / click "🎲 show me others" | 2 techniques drawn at random from the 8-pool (no immediate repeats); click launches one | N/A |
| Provider error/timeout | upstream 4xx/5xx/overloaded | chat shows honest inline error bubble naming the provider ("Gemini hit a snag — try again or switch model"); input re-enabled | 502 passthrough, no crash |
| Missing env vars | request to a provider whose key is unset | 500 with clear message; UI bubble suggests switching provider; README documents envs | logged |

</frozen-after-approval>

## Code Map

- `package.json`, `next.config.ts`, `tsconfig.json` -- Next.js 15 App Router scaffold at repo root
- `middleware.ts` -- cookie auth guard (all routes except /login, /api/auth)
- `app/login/page.tsx` -- password form, pastel-styled
- `app/api/auth/route.ts` -- POST: compare `PLAYGROUND_PASSWORD`, set signed httpOnly cookie
- `app/api/chat/route.ts` -- POST: build Mary system prompt, dispatch to selected provider, stream SSE
- `lib/llm.ts` -- provider adapter: `streamChat(provider, system, messages)` with Gemini + OpenRouter implementations (fetch-based, no heavy SDKs)
- `lib/mary.ts` -- system-prompt builder (persona + facilitation rules + honest-limits + chips protocol)
- `lib/techniques.ts` -- 8-technique pool (name, category, gist, launch prompt) + random-draw helper
- `app/page.tsx` + `components/{Sidebar,Chat,DocPane,Gutter,ModelToggle}.tsx` -- three-pane resizable UI per mock; ModelToggle in chat header; DocPane renders "document arrives in goal 2" placeholder
- `app/globals.css` -- design tokens + styles ported from the mock
- `README.md` -- run/deploy instructions, required env vars

## Tasks & Acceptance

**Execution:**
- [x] `package.json` + config files -- scaffold Next.js 15 (TS, App Router, no Tailwind) at repo root -- foundation
- [x] `app/globals.css` -- port mock's `:root` tokens + component styles -- design fidelity
- [x] `app/api/auth/route.ts` + `middleware.ts` + `app/login/page.tsx` -- shared-password gate w/ httpOnly cookie -- brief MUST
- [x] `lib/techniques.ts` -- 8-technique pool + draw-2-random helper (no immediate repeats on cycle) -- technique surface
- [x] `lib/llm.ts` -- Gemini + OpenRouter streaming adapters behind one interface; provider from request body -- UI-switchable models
- [x] `lib/mary.ts` -- Mary system prompt: persona, facilitation rules, honest-limits, `<chips>` protocol -- CLI-fidelity
- [x] `app/api/chat/route.ts` -- SSE endpoint: auth-checked, provider-dispatched, streams tokens -- core loop
- [x] `components/*` + `app/page.tsx` -- three-pane UI: sidebar (static demo convos), chat w/ bubbles + chips + 2-random technique buttons + 🎲 cycle + ModelToggle, DocPane placeholder, draggable gutters -- the mock, live
- [x] `README.md` -- envs (`GEMINI_API_KEY`, `GEMINI_MODEL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `PLAYGROUND_PASSWORD`, `AUTH_SECRET`), local run, Vercel deploy -- handoff
- [x] Unit-test the I/O matrix edge cases (auth route, chips parser, random-draw helper) -- regression net

**Acceptance Criteria:**
- Given a fresh clone with envs set, when `npm run dev` and I log in, then I see the three-pane pastel UI matching the mock's structure.
- Given the chat, when I click a surfaced technique button (e.g. "Job to Be Done"), then Mary opens that technique with a question — she facilitates rather than lecturing.
- Given the technique row, when I click "🎲 show me others", then two different techniques from the pool replace the current pair without a page reload.
- Given the ModelToggle set to OpenRouter, when I send a message, then the response streams from the OpenRouter model; toggling to Gemini routes the next message to Gemini.
- Given a Mary reply containing a `<chips>` block, when it renders, then chips appear as clickable pills and the raw tag text is never visible.
- Given I ask Mary to browse the web or save a file, when she responds, then she plainly states she can't in this environment and marks it "noted for the builder".
- Given `npm run build`, when it completes, then there are zero type errors and the app is Vercel-deployable.

## Spec Change Log

- 2026-07-14 · Human renegotiation at Checkpoint 1 (pre-approval): (1) technique surface changed from "8 buttons shown" to "2 random + 🎲 cycle button over the same 8-pool"; (2) LLM provider changed from Anthropic `claude-sonnet-5` to UI-switchable Gemini/OpenRouter (keys in Vercel env vars; OpenRouter model env-configurable free tier); (3) confirmed throwaway-grade single-user simplicity. KEEP: chips protocol, honest-limits, 3-pane resizable UI, shared-password gate.
- 2026-07-14 · Human edit at Checkpoint 1: model names env-configurable for BOTH providers — added `GEMINI_MODEL` (default `gemini-2.5-flash`) alongside `OPENROUTER_MODEL`.

## Design Notes

**Technique pool (8):** Job to Be Done, Five Whys, How Might We, Empathy Map, Chaos Engineering, The $0 Mandate, Cross-Pollination, Worst Possible Idea — names/gists lifted verbatim from `brain-methods.csv`; each gets a 2–3 sentence launch prompt telling Mary how to open it. UI surfaces 2 at random; "🎲 show me others" redraws.

**Provider adapter (golden example):**
```ts
type Provider = 'gemini' | 'openrouter';
streamChat(p: Provider, system: string, msgs: Msg[]): ReadableStream<string>
// gemini: POST generativelanguage.googleapis.com …/{GEMINI_MODEL}:streamGenerateContent?alt=sse (default gemini-2.5-flash)
// openrouter: POST openrouter.ai/api/v1/chat/completions {stream:true, model: OPENROUTER_MODEL}
```
Both normalized to a plain text-token stream; chat route is provider-agnostic.

**Chips protocol (golden example):** Mary ends replies with
`<chips>["🔥 Pressure-test it","⛏️ Keep digging","🎲 Switch technique"]</chips>`
Client splits on the tag: text above renders as the bubble; array renders as pills; clicking a pill sends its text as the user message. Absent/malformed block → render text only, no chips, no error.

**Auth:** cookie = HMAC(`AUTH_SECRET`, "playground-v1"); constant-time compare on password. Deliberately minimal — audience of one, throwaway-grade.

## Verification

**Commands:**
- `npm run build` -- expected: clean production build, no type errors
- `npm test` -- expected: auth + chips-parser + random-draw unit tests pass

**Manual checks (if no CLI):**
- Log in, run one technique exchange per provider (Gemini, then OpenRouter): streaming visible, chips clickable, 🎲 redraws pair, gutters drag, phone viewport collapses sidebar.

## Suggested Review Order

**LLM provider adapter (the architectural core)**

- Entry point: one provider-agnostic streaming interface over two upstream APIs
  [`llm.ts:35`](../../lib/llm.ts#L35)

- Typed error taxonomy (missing-key / upstream / timeout / unreachable) drives every user-facing message
  [`llm.ts:12`](../../lib/llm.ts#L12)

- Shared fetch wrapper: 60s timeout + network-failure mapping, bodies never leaked
  [`llm.ts:46`](../../lib/llm.ts#L46)

- SSE line parser with end-of-stream flush (review finding #4)
  [`llm.ts:74`](../../lib/llm.ts#L74)

- Gemini vs OpenRouter payload shapes, models from env only
  [`llm.ts:127`](../../lib/llm.ts#L127)

**Chat pipeline**

- Auth-gated SSE endpoint; error branches map ProviderError kinds to distinct client texts
  [`route.ts:23`](../../app/api/chat/route.ts#L23)

- Mary's system prompt: persona, facilitation rules, honest-limits, chips protocol
  [`mary.ts:5`](../../lib/mary.ts#L5)

- Client stream loop; finalize guards blank/chips-only replies (findings #2/#9)
  [`ChatPane.tsx:53`](../../components/ChatPane.tsx#L53)

- Technique launch appends a visible user turn so history ends on user (finding #1)
  [`ChatPane.tsx:140`](../../components/ChatPane.tsx#L140)

- Chips parsing: strips ALL blocks, chips from last valid one (finding #3)
  [`chips.ts:32`](../../lib/chips.ts#L32)

**Auth & routing**

- Segment-exact public paths + root-asset allowlist (finding #10)
  [`middleware.ts:6`](../../middleware.ts#L6)

- Password check → HMAC cookie issuance
  [`route.ts:4`](../../app/api/auth/route.ts#L4)

**UI shell**

- Three-pane grid, session reset via key-bump (no reload, finding #12), provider state lifted
  [`page.tsx:16`](../../app/page.tsx#L16)

- Technique pool + exclusion-respecting drawTwo (finding #15)
  [`techniques.ts:100`](../../lib/techniques.ts#L100)

- Drag gutters with pointercancel cleanup (finding #11)
  [`Gutter.tsx:1`](../../components/Gutter.tsx#L1)

**Peripherals**

- Route-handler tests: 401/500/cookie-flags
  [`auth-route.test.ts:1`](../../tests/auth-route.test.ts#L1)

- Chips/auth/techniques unit tests (25 total)
  [`chips.test.ts:1`](../../tests/chips.test.ts#L1)

- Envs + run/deploy docs
  [`README.md:1`](../../README.md#L1)
