---
title: "Playground — Product Brief"
status: ready
created: 2026-07-13
updated: 2026-07-13
---

# Playground — Product Brief

## Overview

**Playground** is a no-CLI, ChatGPT-style browser app that delivers BMad's brainstorming methodology to a CLI-averse independent consultant ("Vee") for thinking through *any* problem she's working on. An agent (Mary) runs *real* brainstorming techniques on her fuzzy thinking and hands her a structured, exportable document at the end. Same familiar chat feel as ChatGPT — but the conversation crystallizes into a durable artifact she can keep, export, and send onward. It is deliberately **general-purpose — a "second brain," not a domain-specific tool.**

It is a small, sole-builder proof-of-concept (target: ~2 days, low/medium effort) whose job is to *introduce* a friend to BMad — not to scale.

## Problem & Why Now

Vee already uses ChatGPT as a sounding board, but **everything lives in the chat scroll and nothing becomes a durable document** — the good thinking evaporates. She's also CLI-averse, so the full BMad method (which lives in the terminal) is out of reach for her. There's no gentle, browser-native on-ramp to structured ideation.

## Target User

Vee — an independent fractional consultant who works across a **range of problems** (strategy, positioning, client work — her newest engagement isn't even in her original specialty). She's comfortable in ChatGPT but **CLI-averse**, and on **free ChatGPT** (no Canvas). Works in **spurts**, not continuously. Wants "just show me / nothing to install"; thinks *"is my idea any good? where do I start?"*; wants to feel **capable, not managed**.

v1 is built for an **audience of one** — Vee specifically, not a market — and the tool is deliberately **domain-agnostic**: it must serve whatever she's thinking about, not a single vertical.

## Goals & Success Metric

The three intents, in priority order:

1. **Introduce her to BMad's methodology** — show that ChatGPT isn't the best way; structured frameworks produce better thinking.
2. **Teach her what AI agents are — and their limits** — that AI is *not* magic. Delivered by the agent being honest about what it can't do.
3. **Prove a structured approach beats ChatGPT** on outcome — she walks away sharper, with a document to show for it.

**Success metric: ~10 genuine uses.** Explicitly *not* built for scale, retention, or a moat. It is a foundation that seeds "the next thing" for both the builder and her. Optimize for the **aha** and the **learning**.

## Solution — What It Is

The core loop: **bounce fuzzy ideas off the agent → walk away holding a structured document** (export / PDF / send-to-client).

Key product moves:

- **Techniques as click-and-go buttons** — surface the brainstorming techniques as buttons; one click launches and the agent drives, killing the blank-page problem.
- **Facilitation that reframes & pushes back** — "a process with an opinion, not a mirror." This is the antidote to feeling like generic ChatGPT, and it *is* how intent #3 is proven.
- **A live canvas artifact** she can see assemble as she talks. v1 renders the artifact in a sandboxed inline view; live *voice-editing* of it (Lovable-lite) is deferred.
- **The agent is honest about its limits** — never a hard "I can't"; it names what's out of reach and logs it. Showing the seams is how intent #2 gets taught.
- **Suggested next-steps signpost** — at session end, a lightweight text nudge ("this could become a product brief / PRD next") so the natural evolution of a brainstorm is *felt* without building a second skill engine.
- **Dynamic command options** — BMad custom commands (agent menu items, technique moves, converge/wrap-up) surface as **contextual chips**, dynamically, only when relevant — the CLI's menu-table reborn as UI.
- **Conversations are first-class** — each conversation can be **renamed** and **referred to** from other chats (e.g. `@rebrand-idea`); each conversation **owns its artifacts**; and the agent can **see into any conversation** when useful. Single-user makes this cheap (all sessions are rows in Neon) and it quietly delivers the "second brain" feel without a dedicated memory system.

A large share of v1 is **skinning machinery that already exists** in BMad (the technique catalog, the session-log/auto-save, the closing synthesis) rather than building from scratch.

### Design Principle — CLI-Fidelity

The browser chat must **faithfully mirror the BMad CLI agent chat**: the same agent activation, skill dispatch, memlog-driven session, technique flow, and artifact generation that happen in the terminal today. The UI changes the *surface* (no terminal, no install, a friendlier presentation), never the *substance* — nothing of the method is lost in translation. Concretely, the browser runtime executes the *same* skill instructions found in BMad's source files (SKILL.md + references), so the experience a user gets in the app equals the experience they'd get in the CLI, minus the CLI.

"Mirror" means fidelity of *flow and capability*, not terminal aesthetics — menus, personas, and technique-runs are reproduced faithfully, but presented in a warm, ChatGPT-familiar way rather than as raw terminal output.

## Scope — v1 (MoSCoW)

### Must

- No-CLI, ChatGPT-style chat behind a single shared password
- Mary + a **curated starter set** of brainstorming techniques as click-and-go buttons (not the full catalog)
- Facilitation that reframes/pushes back (proves intent #3)
- Live canvas artifact (inline render)
- Walk-away document with **plain export + PDF**
- Agent honest about its limits (delivers intent #2)
- Dynamic command chips (BMad custom commands as contextual options)
- Conversations: renameable, referable, each owning its artifacts; agent can read across conversations
- $10 app-level usage cap; stack = Vercel + Neon + Upstash

### Should

- Capability-gap ledger → consent "outbox" of a build backlog to the builder
- Resumable sessions (auto-save)
- Technique auto-suggest / "start here"
- Shareable artifact URL; artifact library

### Could

- True multitenant; MCP tool shelf; live voice-editing of the artifact; more agents than Mary; a guided "build your own agent" demo; persistent second-brain memory

### Won't (this time)

- Multi-skill handoff *engine* (brainstorm → brief → PRD as live skills) — replaced by the text signpost
- Crudo delivery; code execution / sandbox; autonomous email / heavy integrations; anything optimizing scale, retention, or long-horizon compounding

## Constraints & Stack

- **Effort:** ~2 days, sole builder, low/medium effort — a personal target, not a hard external deadline. This is the constraint every scope decision bows to.
- **Stack:** Vercel + Neon (Postgres) + Upstash (Redis) — all already owned. Artifacts and session state become Neon rows; Vercel serves a sandboxed artifact view (strict CSP, self-contained HTML); Upstash handles caching and queued long calls. Auth is a single shared password for v1; true multitenancy deferred.
- **Budget guardrail:** $10 app-level usage cap via in-app quotas — no cloud console needed.
- **One real technical wall:** arbitrary code execution on Vercel serverless — walled off and not needed for v1.
- **Porting note:** BMad skills currently depend on filesystem + Python scripts + markdown assets; the browser version re-homes these as server logic + Neon/Upstash tool-calls inside an agent loop, rather than shelling out.

## Risks

1. **Scope bloat (the #1 risk).** The pull toward "support every skill / every agent / handoffs" turns a weekend build into a platform. **Mitigation:** brainstorming-only v1, one agent, signpost instead of a handoff engine, MoSCoW enforced hard.
2. **The "meh" death.** Output feels like generic ChatGPT and she drifts back. **Mitigation:** the canvas artifact + facilitation that pushes back; she's on free ChatGPT (no Canvas), so the bar to feel premium is low.
3. **Cost surprise** on the builder's API key. **Mitigation:** the $10 in-app cap.

## Out of Scope / Future

- **Crudo** — a separate, existing *domain-specific* BMad agent in the separate private repo. Playground is deliberately **general-purpose**, so Crudo is explicitly **not** part of it; it stays a distinct track that could be surfaced later if the foundation proves out.
- **Multi-skill handoff engine**, **more agents**, **second-brain persistence**, and **true multitenant** — all future, gated on whether the ~10 uses prove the foundation worth extending.
