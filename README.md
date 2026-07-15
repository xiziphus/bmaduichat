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
| `DATABASE_URL` | no (optional) | — | Neon Postgres connection string. **Unset → the app runs exactly as before** (ephemeral, in-tab conversations). Set + migrated → conversations and history persist. |

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
