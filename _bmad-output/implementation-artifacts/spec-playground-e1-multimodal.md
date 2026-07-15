---
title: 'Playground v2 — Epic E: multimodal input (attachments, voice) + capability toast'
type: 'feature'
created: '2026-07-16'
status: 'ready-for-dev'
baseline_commit: '11d2d25'
context:
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-Playground-2026-07-16/prd.md'
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** Vee can only type. She wants to upload images, PDFs, and documents, and speak instead of type — but not every model can read every modality.

**Approach:** Add attachments (images, PDFs, text/markdown docs) and voice-to-text to the composer; send images/PDFs to the provider as native multimodal parts, inline text-docs as text (works on any model). Before sending an unsupported modality, warn via a **toast** naming which model can handle it. Keep it lightweight — no blob storage, no docx parser, no audio-to-model pipeline.

## Boundaries & Constraints

**Always:**
- **Attach button (📎)** in the composer opens a file picker for: images (`png/jpeg/webp/gif`), `application/pdf`, and text (`text/plain`, `text/markdown`). Multiple files; show removable chips/thumbnails above the input. Client size cap (default 10MB/file, ~4 files) with a toast on exceed.
- **Modality routing:** text/markdown files are read client-side and their content is inlined into the prompt (labelled, e.g. `[Attached: notes.md]\n<content>`) — works on ANY model. Images + PDFs are sent as provider-native parts:
  - Gemini: `inlineData` `{mimeType, data(base64)}` parts.
  - OpenRouter (OpenAI-compat): `image_url` content parts with base64 data URLs (PDFs only where the model supports `file`/document parts).
- **Capability map + toast (the key UX):** a `MODALITY_SUPPORT` table. Gemini → images+pdf supported. OpenRouter → treat as text-only UNLESS the configured `OPENROUTER_MODEL` matches a known-multimodal allowlist OR `OPENROUTER_MULTIMODAL=true` env is set. When the user attaches an image/PDF and the current provider/model can't handle it, show a **toast** ("The current OpenRouter model can't read images — switch to Gemini in the header, or set a vision-capable model.") and DO NOT silently drop it: block the send (keep the attachment) until they switch provider or remove it. Text-doc attachments never trigger the toast.
- **Voice (🎙):** use the browser Web Speech API (`webkitSpeechRecognition`/`SpeechRecognition`) → transcribe to text appended into the input. Recording state shown (pulsing mic). If the browser lacks the API, a toast ("Voice input isn't supported in this browser").
- **Toast component:** lightweight, self-built (no lib), pastel-consistent, top-center or bottom, auto-dismiss ~4s, stackable, dismissible. Reusable (`useToast`/`<Toaster>`).
- Attachments are sent to the model with the message; **persist only lightweight metadata** on the message row (filename, mimeType, size — NOT the binary) so the thread shows "📎 filename" after refresh. Binaries are ephemeral this epic.
- Graceful: no DB → still works (attachments just aren't persisted as metadata); no provider key → existing honest error.

**Ask First:**
- Adding blob storage (Vercel Blob/S3) to persist binaries.
- Adding a server-side transcription or docx/xlsx parser.
- Any paid API.

**Never:**
- No sending an unsupported modality silently.
- No storing large binaries in Postgres.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Attach image on Gemini | png + text | image sent as inlineData; reply references it | provider error → honest bubble |
| Attach image on unsupported OpenRouter model | png attached | TOAST "switch to Gemini"; send blocked; attachment kept | N/A |
| Attach .md doc on any model | notes.md | content inlined into prompt; works | unreadable file → toast |
| Attach PDF on Gemini | doc.pdf | sent as inlineData document part | model rejects → honest bubble + toast suggesting switch |
| Voice, supported browser | click mic, speak | transcript appended to input | no speech → nothing, mic resets |
| Voice, unsupported browser | click mic | toast "not supported here" | N/A |
| Oversize file | 30MB image | toast "file too large (max 10MB)"; not attached | N/A |
| Refresh after attach | thread had 📎 | message shows "📎 filename" chip (metadata) | binary not re-shown (ephemeral) |

</frozen-after-approval>

## Code Map

- `components/Toaster.tsx` + `lib/toast.ts` -- toast system (context/hook + renderer)
- `components/Composer` area in `components/ChatPane.tsx` -- 📎 attach, 🎙 mic, attachment chips, size checks, capability gate
- `lib/attachments.ts` -- file→part conversion, text-file inlining, size/type validation, `MODALITY_SUPPORT` map + `canSend(provider, model, attachments)`
- `lib/llm.ts` -- extend `Msg` to carry parts (text + image/pdf/inlined-text); Gemini + OpenRouter formatters build native multimodal payloads
- `app/api/chat/route.ts` -- accept structured message parts; persist attachment METADATA on the message row (when DB on)
- `db/schema.sql` -- add `attachments jsonb` (metadata array) to `messages` (fresh-schema column; migrate note)
- `lib/repo/messages.ts` -- persist/read attachment metadata
- `lib/mary.ts` -- brief note that she may receive attached images/docs and should use them
- `app/globals.css` -- toast styles, attach/mic buttons, attachment chips/thumbnails, recording pulse
- tests -- `canSend` capability logic, text-file inlining, per-provider part formatting, size/type validation

## Tasks & Acceptance

**Execution:**
- [ ] `components/Toaster.tsx` + `lib/toast.ts` -- reusable toast
- [ ] `lib/attachments.ts` -- validation, text inlining, MODALITY_SUPPORT + canSend
- [ ] `lib/llm.ts` -- Msg parts + Gemini/OpenRouter multimodal formatters
- [ ] `components/ChatPane.tsx` -- attach/mic UI, chips, capability gate + toasts, send parts
- [ ] `app/api/chat/route.ts` + `lib/repo/messages.ts` + `db/schema.sql` -- accept parts, persist attachment metadata
- [ ] `app/globals.css` -- styles
- [ ] `lib/mary.ts` -- attachments awareness note
- [ ] tests -- canSend, inlining, formatting, validation

**Acceptance Criteria:**
- Given Gemini selected, when I attach an image and send, then Mary receives and can describe/use it.
- Given an OpenRouter text-only model, when I attach an image, then a toast tells me to switch to Gemini and the send is blocked (attachment retained) — never silently dropped.
- Given any model, when I attach a .md file, then its text is included and used, no toast.
- Given a supported browser, when I click the mic and speak, then the transcript lands in the input.
- Given an oversize or unsupported file, then a toast explains and it isn't attached.
- Given no DATABASE_URL, the app still works (attachments unpersisted); `npm run build` clean; `npm test` green; existing behavior unregressed.

## Design Notes

**MODALITY_SUPPORT (starting point):** `gemini: { image: true, pdf: true }`. `openrouter: { image: false, pdf: false }` by default, overridden to true if `OPENROUTER_MODEL` is in a small known-vision allowlist (e.g. contains `gpt-4o`, `claude-3`, `gemini`, `llama-3.2-vision`, `qwen*-vl`, `pixtral`) or `OPENROUTER_MULTIMODAL=true`. Document the allowlist as builder-tunable via env. Because free OpenRouter models are usually text-only, the default-false + toast is the safe UX the user asked for.

**Keep voice simple:** Web Speech API only — no audio bytes to any model, no transcription service. That fully sidesteps the audio-modality capability problem.

## Verification

**Commands:** `npm run build` clean · `npm test` green
**Manual:** On Gemini attach an image → Mary uses it; switch to OpenRouter free model, attach image → toast + blocked; attach .md → inlined; mic → transcribes.
