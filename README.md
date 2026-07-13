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

Copy `.env.example` to `.env` and fill in the values you plan to use. You only need keys for the
provider(s) you intend to select in the UI's model toggle — the other can be left blank.

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
