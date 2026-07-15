# Playground

Playground is a single-user, throwaway-grade browser app for brainstorming with "Mary," an
AI Business Analyst who facilitates structured ideation techniques (Job to Be Done, Five Whys,
How Might We, and five more) over a streaming chat, behind a one-password gate — no database,
no accounts, no persistence beyond the current browser tab in this first slice.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PLAYGROUND_PASSWORD` | yes | — | The one password that unlocks the app |
| `AUTH_SECRET` | yes | — | Random secret used to HMAC-sign the auth cookie |
| `GEMINI_API_KEY` | only if using Gemini | — | Google Generative Language API key |
| `GEMINI_MODEL` | no | `gemini-2.5-flash` | Gemini model id |
| `OPENROUTER_API_KEY` | only if using OpenRouter | — | OpenRouter API key |
| `OPENROUTER_MODEL` | no | `meta-llama/llama-3.3-70b-instruct:free` | OpenRouter model id (pick any free-tier model) |
| `OPENROUTER_MULTIMODAL` | no | `false` | Force image/PDF support on for OpenRouter. See [Attachments](#attachments-images-pdfs-docs--voice). |
| `DATABASE_URL` | no (optional) | — | Neon Postgres connection string. **Unset → the app runs exactly as before** (ephemeral, in-tab conversations). Set + migrated → conversations and history persist. |
| `BUDGET_USD` | no | `10` | Monthly spend cap (USD). A safety net, not accounting — cost is **estimated** from a small per-model price table. Requires `DATABASE_URL`; with no DB there's no metering or cap. |

## Budget cap (optional, requires a database)

When `DATABASE_URL` is set, each billable chat completion writes an **estimated** usage
row (provider, model, token counts, cost) and the header shows a `$spent / $cap` meter for
the current calendar month. Cost is estimated from a small, builder-tunable price table
(`lib/usage.ts`) using provider-reported token counts (Gemini `usageMetadata`, OpenRouter
final-chunk `usage`) or a ~4-chars/token fallback — treat it as a guardrail, not a bill.

- At **80%** of the cap you get a one-time warning.
- At **100%**, a billable request is **blocked** with an honest bubble suggesting a free model.
- **Free OpenRouter models** (id ending `:free`) are never counted and **always work**, even at 100%.
- Unknown/untabled models cost 0, so they never block.

## Builder notes outbox

When Mary says something is *"noted for the builder"*, the excerpt is captured. With a
database configured it persists to the `builder_notes` table (visible across devices via the
📮 drawer); select notes and **Send to builder** flips them to a builder-visible "Sent" tab.
With no database it falls back to browser-local storage, exactly as before.

## Attachments (images, PDFs, docs) + voice

The composer has a 📎 attach button (images `png/jpeg/webp/gif`, `application/pdf`, and
`text/plain` / `text/markdown`) and a 🎙 voice button. Limits: **10MB per file, up to 4 files**;
oversize/unsupported files raise a toast and aren't attached.

- **Text/markdown docs** are read in the browser and **inlined** into the message
  (`[Attached: name]\n<content>`) — so they work on **any** model.
- **Images and PDFs** are sent as provider-native multimodal parts.
- **Voice** uses the browser's Web Speech API (`webkitSpeechRecognition`/`SpeechRecognition`) to
  transcribe speech into the input — no audio bytes ever leave the browser. If the browser lacks
  the API, a toast says so.
- Only lightweight **attachment metadata** (filename, mime type, size) is persisted on the message
  row; binaries are ephemeral (a refreshed thread shows a `📎 filename` chip, not the image).

### Which models can read images/PDFs?

Not every model is multimodal, so the app **gates by capability** and warns before sending:

| Provider | Image / PDF support |
|---|---|
| **Gemini** | Always (images + PDFs). |
| **OpenRouter** | **Text-only by default.** Enabled only if `OPENROUTER_MODEL` matches a known-vision allowlist — model ids containing `gpt-4o`, `claude-3`, `gemini`, `llama-3.2-vision`, `qwen…-vl`, or `pixtral` — **or** `OPENROUTER_MULTIMODAL=true`. |

If you attach an image/PDF while on an OpenRouter model that can't read it, the send is **blocked**
with a toast ("switch to Gemini … or set a vision-capable model") and the attachment is kept —
never silently dropped. Text-doc attachments never trigger this. The allowlist lives in
`lib/attachments.ts` (`OPENROUTER_VISION_PATTERNS`) and is builder-tunable.

> **Schema note:** attachment metadata lives in a `messages.attachments jsonb` column. Because
> `db/schema.sql` is applied with `CREATE TABLE IF NOT EXISTS` (no `ALTER`), the column is created
> automatically only on a **fresh** database. On an **already-migrated live DB**, add it once with:
> `ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments jsonb;`

Copy `.env.example` to `.env` and fill in the values you plan to use. You only need keys for the
provider(s) you intend to select in the UI's model toggle — the other can be left blank.

## Persistence (optional)

Persistence is **off by default** and entirely optional — with no `DATABASE_URL` the app behaves
exactly like the stateless version (conversations live only in the browser tab). To turn on saved
conversations and message history:

1. **Provision Neon** — create a project at [neon.tech](https://neon.tech) and copy its pooled
   connection string (looks like `postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`).
2. **Set `DATABASE_URL` locally** — add it to `.env`.
3. **Run the migration** — `npm run db:migrate`. This applies `db/schema.sql` (idempotent
   `CREATE TABLE IF NOT EXISTS`), creating the full v2 schema.
4. **Set `DATABASE_URL` in Vercel** — add it to the project's environment variables
   (Production + Preview), then redeploy. Run `npm run db:migrate` once against the same database.

When enabled, the sidebar lists your saved conversations (newest first), clicking one rehydrates its
full thread, and **New conversation** creates a fresh row without deleting the previous one. If the
database is ever unreachable, the app degrades gracefully to ephemeral behavior rather than erroring.

> **Schema note:** `db/schema.sql` is a **fresh-schema definition** applied by `CREATE TABLE IF NOT
> EXISTS` — `npm run db:migrate` does not ALTER existing tables. The `messages.seq` identity column
> (which guarantees user-before-assistant ordering within a single write transaction) is part of this
> definition, so migrate against a clean database. If you already created the tables from an earlier
> draft of this schema, drop them (or use a fresh Neon branch) before re-running the migration.

## Local run

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`, log in with `PLAYGROUND_PASSWORD`, and start brainstorming.

## Tests & build

```bash
npm test    # vitest — chips parser, auth cookie sign/verify, technique draw-two
npm run build
```

## Vercel deploy

1. Import this repo into Vercel (root directory — it's a standard Next.js App Router project).
2. Set the environment variables above in the Vercel project settings (Production + Preview).
3. Deploy. No build-step configuration is needed beyond the default `next build`.
4. There is no database — conversation history lives only in the browser tab for this slice.
