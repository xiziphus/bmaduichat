# Brainstorm Intent: BMad Browser UI (Mary + Brainstorming)

## Product thesis
A disarming, no-CLI, ChatGPT-style brainstorming "board" — a browser app that delivers BMad's brainstorming techniques to a CLI-averse fractional GTM/SEO/AEO consultant ("Vee"). An agent (Mary) runs real BMad techniques on her fuzzy thinking and hands her a structured, exportable document. Same familiar chat UX as ChatGPT, but the conversation crystallizes into a durable artifact she can keep, export, and send onward.

## Why / the three core intents
These are the real purpose (initial requirements):
1. **Introduce her to BMad's methodology** — show that ChatGPT isn't the best way; better techniques exist; you just need a proper framework.
2. **Introduce her to AI agents AND their limits** — what agents are, what they can and can't do, and that AI is NOT magic. (The agent's honesty about its own limits is what teaches this.)
3. **Prove a structured approach beats ChatGPT on outcome.**

## Success metric
~10 genuine uses. Explicitly NOT built for scale or retention. It is an educational proof-of-concept and a foundation that seeds the next thing — giving BOTH the builder and her "enough to work on next." Optimize for the AHA and the learning, not compounding value or a moat.

## Target user (persona)
Vee — a fractional GTM expert (GTM is her core). Strong at SEO, newer to AEO/GEO. Tools: Semrush, Ahrefs, Shopify (Shopify is her thing). Clients: luxury retail (fabric/clothing lines), now also US + Canada. Works in spurts/bursts, not continuously. On free ChatGPT (no Canvas). CLI-averse — already trusts the ChatGPT chat paradigm and wants "just show me / nothing to install." Thinks "is my idea any good? where do I even start?"; rambles in ChatGPT then loses it; wants to feel capable, not managed.

## Core loop / must-win job
Bounce fuzzy ideas off the agent → walk away holding a **structured document**. Every session ends with something tangible that can: optionally go into memory (opt-in second brain), be exported / made into PDF, and be sent to the client if needed. The artifact is portable — it has a life beyond the app.

Contrast vs ChatGPT: in ChatGPT nothing survives the scroll. Here the conversation becomes a real saved, portable artifact. ChatGPT is a mirror; BMad is a process with an opinion.

Note: the product pivoted from SEO-locked to a general-purpose "second brain" — she works on all sorts of problems, not just SEO. v1 is brainstorming techniques to introduce her to BMad.

## Key product moves
- **Techniques as click-and-go buttons** — surface all brainstorming techniques as buttons; one click launches and the agent drives the flow, killing the blank-page problem.
- **Facilitation that reframes & pushes back** — "process with an opinion, not a mirror." The agent runs a REAL method (JTBD, brainstorming techniques) on her. This is the antidote to "meh"/undifferentiation vs ChatGPT and directly proves intent #3.
- **Live canvas artifact** — an artifact she can SEE, INTERACT with, and CHANGE in real time by talking to the agent. "Lovable-lite within boundaries": conversational live-editing of self-contained HTML (NO code exec, NO deploy). Do inline sandboxed iframe + shareable artifact URL + artifact library/gallery. Feels premium to a free-ChatGPT user.
- **Agent HONEST about its limits** — never says "I can't"; graceful degradation as delight. Showing the seams is the pedagogy that delivers intent #2 (AI isn't magic).
- **Capability-gap feedback ledger → consent "outbox"** — when the agent detects any missing capability (an MCP or any functionality that doesn't exist), it logs it in the backend with WHY + task context + frequency. Later, WITH her consent, a consolidated, evidence-backed build backlog is sent to the builder. Gap-detection is discovered in-conversation via a per-agent "capability manifest." Rule: whatever can't be done in this environment becomes part of the document. Gaps must live on the PERIPHERY and NEVER block the core idea→doc loop.

## v1 scope (MoSCoW)
**MUST (v1):**
- No-CLI ChatGPT-style chat + shared-password auth
- Mary + brainstorming techniques as click-and-go buttons
- Facilitation that reframes/pushes back (proves structure > ChatGPT — Goal 3)
- Live canvas artifact
- Walk-away doc with export + PDF
- Agent HONEST about limits (delivers Goal 2)
- $10 app-level usage cap
- Vercel + Neon + Upstash

**SHOULD:**
- Capability-gap ledger → consent "outbox" to builder
- Resumable sessions (memlog auto-save)
- Technique auto-suggest / "start here"
- Shareable artifact URL
- Artifact library

**COULD:**
- True multitenant
- MCP tool shelf
- Live voice-editing of HTML artifact (Lovable-lite)
- More agents beyond Mary
- Guided "build your own agent" demo
- Second-brain persistent memory

**WON'T (this time):**
- Crudo delivery
- Code execution / sandbox
- Autonomous email / heavy integrations
- Scale / retention / 18-month compounding

## Constraints & stack
- **Stack:** Vercel + Neon (Postgres) + Upstash (Redis) — user owns all three; design within these. Neon stores HTML + metadata (versioned TEXT rows); Vercel serves the artifact route + sandboxed iframe (srcdoc + strict CSP, self-contained HTML); Upstash caches renders; optional Vercel Blob for large assets.
- **Budget:** $10 app-level usage cap via in-app quotas — no cloud console needed.
- **Only real wall = code execution** on Vercel serverless. Walled off and not needed for v1. (Remote/HTTP MCP works from Vercel; local stdio/Docker MCP would need an always-on host — deferred.)
- **Crudo** = an existing WORKING BMad custom agent in the private repo ("GTM Product SEO Strategist" codifying Vee's SEO/AEO IP; runs today as CLI `/crudo`). It is DEFERRED future context / a later stage, NOT v1.
- **v1 largely skins machinery that already exists:** brain-selector.html (techniques-as-buttons), memlog.py (auto-save/resume), finalize.md synthesis (the canvas artifact). Skin what already works rather than building from scratch.

## Open questions / next
- Auth: shared-password for v1; true multitenancy deferred to COULD. Per-user OAuth (Gmail/Drive/Figma) is the real complexity if MCP tool shelf is ever pursued.
- Product arc beyond v1: Mary (brainstorming on-ramp) → Crudo (domain killer app) as one funnel, two agents; the brainstorm artifact becomes the INPUT to Crudo. Not in v1, but frames the "next thing" the ~10 uses are meant to seed.
- Second-brain persistence is de-prioritized given the ~10-use success metric; revisit only if the foundation warrants a follow-on product.
