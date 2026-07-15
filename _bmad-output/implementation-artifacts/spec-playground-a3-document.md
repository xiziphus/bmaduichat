---
title: 'Playground v2 — Epic A stories A-3 + A-4: markdown rendering, artifacts, live doc pane, export'
type: 'feature'
created: '2026-07-16'
status: 'ready-for-dev'
baseline_commit: '09b496f'
context:
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-Playground-2026-07-16/prd.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epics-playground-v2.md'
  - '{project-root}/_bmad-output/design-mocks/playground-final-mock.html'
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** (1) Markdown is not rendered — Mary's `**bold**`, headings, lists show as literal text in chat bubbles AND the doc pane. (2) Brainstorm synthesis doesn't become a saved, formatted document; there's no export.

**Approach:** Add ONE lightweight, sanitized markdown→HTML renderer used in both the chat bubbles and the doc pane. Persist agent-produced documents as `artifacts` rows and render the latest in the doc pane with the mock's typography. Add export (copy-markdown, print-CSS PDF, stable authed artifact URL). Persistence stays graceful — no DB → today's behavior.

## Boundaries & Constraints

**Always:**
- **Markdown rendering:** use a small, well-maintained, sanitized renderer (e.g. `react-markdown` + `remark-gfm`, or `marked` + `dompurify`). Must be XSS-safe (agent output is untrusted): no raw HTML injection, links `rel=noopener`. Render in chat bubbles (Mary's messages) and the doc pane. Do NOT render the user's own bubbles as markdown (plain text) to avoid surprises. The `<chips>` block is already stripped before render — keep that.
- **Doc pane typography** follows the mock (`#paper` styles already in globals.css): Fraunces headings, Newsreader body, pull-quotes, lists, tables, callouts. Map rendered markdown elements onto that CSS.
- **Artifacts:** when an agent completes a synthesis/wrap-up document (detectable via a lightweight convention — see Design Notes), write an `artifacts` row (conversation-scoped, versioned) and show it live in the doc pane. Uses the existing `lib/repo/artifacts.ts` stub — flesh it out.
- Persistence graceful: no DATABASE_URL → doc pane still renders in-memory for the current session; no artifact rows; no errors.
- Keep auth on every new route.

**Ask First:**
- Adding a headless-browser PDF lib (Puppeteer etc.) — default is print-CSS `window.print()` to PDF, no server rendering.
- Any markdown renderer larger than ~50KB gzipped.

**Never:**
- No @refer, rename, budget, or runtime work (Epics B–D).
- No raw `dangerouslySetInnerHTML` without sanitization.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Mary sends markdown | reply with `**b**`, `## h`, `- list` | rendered bold/heading/list in the bubble | malformed md → render as text, never crash |
| Synthesis produced | agent emits a document | artifact row written (if DB), doc pane shows it formatted | DB off → render in-pane, no row |
| Reopen conversation | has a saved artifact | latest artifact version renders in doc pane | none → placeholder |
| Regenerate | new version of same doc | new version row; doc pane shows latest; prior versions retained | N/A |
| Copy markdown | click Copy | raw markdown on clipboard | N/A |
| PDF | click PDF | print dialog / PDF of the doc pane only (print CSS) | N/A |
| Artifact URL | GET /artifacts/[id] authed | sandboxed render of that artifact | 404 if missing; 401 unauth |
| XSS attempt | md contains `<script>`/`onerror` | sanitized away, inert | N/A |

</frozen-after-approval>

## Code Map

- `lib/markdown.tsx` (or `components/Markdown.tsx`) -- the single sanitized renderer, shared
- `components/ChatPane.tsx` -- render Mary bubbles through it (user bubbles stay plain)
- `components/DocPane.tsx` -- render the current artifact's markdown with `#paper` typography; header actions (Copy, PDF)
- `lib/repo/artifacts.ts` -- flesh out CRUD (create version, get latest for conversation, get by id)
- `app/api/chat/route.ts` -- when an assistant turn is a document (Design Notes), persist an artifact + return its id to the client
- `app/api/artifacts/[id]/route.ts` -- authed GET → sandboxed render page/route
- `app/page.tsx` / state -- doc pane reflects the conversation's latest artifact; live-updates as it streams
- `app/globals.css` -- print stylesheet (`@media print`) that isolates the doc pane; any element styles the renderer needs
- `package.json` -- the markdown + sanitize deps
- tests -- markdown renderer (bold/heading/list/table + XSS sanitized), artifacts repo shape

## Tasks & Acceptance

**Execution:**
- [ ] `components/Markdown.tsx` -- sanitized md→HTML renderer, XSS-safe, mapped to doc + chat styles
- [ ] `components/ChatPane.tsx` -- Mary bubbles rendered as markdown (user plain); chips still stripped
- [ ] `lib/repo/artifacts.ts` -- createVersion / getLatestForConversation / getById
- [ ] `app/api/chat/route.ts` -- detect + persist document turns as artifacts (graceful)
- [ ] `components/DocPane.tsx` + `app/page.tsx` -- render latest artifact w/ mock typography; live update; Copy + PDF
- [ ] `app/api/artifacts/[id]/route.ts` -- authed sandboxed render
- [ ] `app/globals.css` -- `@media print` isolating the doc pane
- [ ] tests -- renderer (formatting + XSS), artifacts repo shape

**Acceptance Criteria:**
- Given Mary replies with `**bold**` and a `## heading` and a list, when it renders, then bold is bold, the heading is a heading, and the list is a list — in both the chat bubble and (for a document) the doc pane. No literal asterisks.
- Given a brainstorm wrap-up, when it completes, then a formatted document appears in the doc pane and (DB on) survives refresh as a saved artifact.
- Given the doc pane has content, when I click Copy then PDF, then I get the markdown on clipboard and a clean PDF of just the document.
- Given agent markdown containing `<script>`, when rendered, then the script is stripped and nothing executes.
- Given no DATABASE_URL, the app still renders markdown and behaves like today otherwise; `npm run build` clean, `npm test` green.

## Design Notes

**"Is this turn a document?" convention (keep it simple, CLI-fidelity-friendly):** the agent wraps a durable artifact in a fenced sentinel, e.g. it emits the document inside `<document title="...">…markdown…</document>` (mirrors how `<chips>` already works). The chat route/client: if a `<document>` block is present, strip it from the chat bubble, persist/replace the conversation's artifact with its body, and render it in the doc pane. Absent → normal chat, doc pane unchanged. Update Mary's system prompt (lib/mary.ts wrap-up/finalize section) so that at synthesis/wrap-up she emits the `<document>` block (this is the browser equivalent of finalize.md writing an artifact — note it as an adapter concern for later runtime work, but implement the client/prompt side now).

**Renderer:** prefer `react-markdown` + `remark-gfm` (tables, strikethrough) with a strict `allowedElements`/no-raw-HTML config; or `marked` + `dompurify`. Style via the existing `#paper`/`.b.mary` CSS — add element rules as needed rather than inline styles.

## Verification

**Commands:**
- `npm run build` -- clean · `npm test` -- green

**Manual:**
- With DB on: brainstorm → wrap-up → formatted doc in pane → refresh → still there → Copy/PDF work. Markdown renders in chat throughout.
