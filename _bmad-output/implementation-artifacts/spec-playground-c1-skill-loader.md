---
title: 'Playground v2 — Epic C-1: generic skill loader + manifest + TOML merge'
type: 'feature'
created: '2026-07-16'
status: 'ready-for-dev'
baseline_commit: 'e4fb192'
context:
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-Playground-2026-07-16/prd.md'
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-Playground-2026-07-16/addendum.md'
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** Mary's prompt is hand-assembled from a fixed set of brainstorming files (`lib/bmad-source.ts`). To deliver *all* BMad agents/skills, we need to load ANY skill's files + merged config generically — no per-skill TypeScript.

**Approach:** A generic **skill loader**: given a skill slug, read its `SKILL.md`, its `references/*`, and its merged `customize.toml` (base → team → user, deep-merged in TS with BMad's exact rules). A **manifest** enumerates installed agents + skills by scanning `.claude/skills/`. This is foundation (a lib + manifest + tests) — no user-facing behavior change yet; `lib/bmad-source.ts`/`lib/mary.ts` keep working (ideally re-expressed on the loader, but Mary's runtime output must stay byte-equivalent).

## Boundaries & Constraints

**Always:**
- **TOML merge in TS (FR-33)** matching `_bmad/scripts/resolve_customization.py` exactly: read base `{skill}/customize.toml`, then `_bmad/custom/{skill}.toml` (team), then `_bmad/custom/{skill}.user.toml` (user); missing files skipped; **scalars override; tables deep-merge; arrays-of-tables keyed by `code` or `id` replace matching + append new; all other arrays append.** Use a small TOML parser dep (e.g. `smol-toml` or `@iarna/toml`) — lightweight.
- **Skill loader:** `loadSkill(slug)` → `{ slug, skillMd, references: Record<name,content>, config }` reading from `.claude/skills/{slug}/`. References are available for just-in-time reading (don't force-load all into one blob). Repo reads via the proven `bmad-source` fs pattern; ensure Vercel tracing includes `.claude/skills/**` (extend `outputFileTracingIncludes`).
- **Manifest:** `getManifest()` scans `.claude/skills/` → list of `{ slug, kind: 'agent'|'skill', name, icon?, description?, menu? }`. Agents are skills whose `customize.toml` has an `[agent]` block with a menu (e.g. `bmad-agent-analyst`); the rest are workflow skills. Cache at module scope. Build a small allow-scan list or derive from directory names + frontmatter.
- **Adapter seam (prep for FR-34):** a documented `adaptMechanics(text)` function that neutralizes CLI-only mechanics in loaded skill text (memlog `uv run` invocations, `{placeholder}` tokens, composer-page/file-path references) — start with the transforms `lib/bmad-source.ts` already applies, centralized here. Skill files stay byte-identical on disk; adaptation happens at load.
- Server-only (`import 'server-only'`); never bundled client-side. Auth not applicable (internal lib). No DB dependency.

**Ask First:**
- Any TOML lib larger than ~30KB or with native deps.
- Changing Mary's actual runtime prompt text (must stay equivalent).

**Never:**
- No editing skill source files on disk.
- No checkpoint/tool-layer/UI work (C-2/C-3/C-4). This is loader + manifest + merge only.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected | Error |
|---|---|---|---|
| Load agent skill | `loadSkill('bmad-agent-analyst')` | skillMd + references + merged config incl `[agent]` menu | missing dir → clear error |
| TOML merge | base+user override present | user scalars win, keyed arrays replace-by-code, arrays append | malformed toml → error naming file |
| Manifest | `getManifest()` | agents (Mary, John, …) + skills (brainstorming, prd, …) with names/icons | empty dir → [] |
| Missing reference | ref not on disk | loader omits it / returns undefined for that name | no crash |
| Mary equivalence | build Mary prompt via loader | byte-equivalent to current `lib/mary.ts` output | N/A |

</frozen-after-approval>

## Code Map

- `lib/skills/loader.ts` -- `loadSkill(slug)`, reference access, `adaptMechanics`
- `lib/skills/toml.ts` -- `resolveCustomization(slug)` deep-merge (base→team→user), matching the Python resolver
- `lib/skills/manifest.ts` -- `getManifest()` scan + classify agents vs skills, cached
- `lib/bmad-source.ts` / `lib/mary.ts` -- re-express on the loader if clean; MUST keep Mary's output equivalent
- `next.config.ts` -- ensure `.claude/skills/**` traced into the functions that load skills
- `package.json` -- TOML parser dep
- tests -- toml merge (fixture vs. expected, incl. keyed-array replace + array append + scalar override), loader (agent + workflow skill), manifest classification, Mary equivalence snapshot

## Tasks & Acceptance

**Execution:**
- [ ] `lib/skills/toml.ts` -- resolveCustomization deep-merge per BMad rules
- [ ] `lib/skills/loader.ts` -- loadSkill + adaptMechanics (centralize bmad-source transforms)
- [ ] `lib/skills/manifest.ts` -- scan + classify, cached
- [ ] `lib/bmad-source.ts`/`lib/mary.ts` -- keep Mary equivalent (re-express if clean)
- [ ] `next.config.ts` -- tracing for `.claude/skills/**`
- [ ] tests -- toml/loader/manifest/Mary-equivalence

**Acceptance Criteria:**
- Given `loadSkill('bmad-agent-analyst')`, then it returns the SKILL.md, its references, and a merged config whose `[agent]` menu matches the file.
- Given a base + user `customize.toml`, when merged, then scalars override, `code`/`id`-keyed table arrays replace-or-append, other arrays append — matching `resolve_customization.py` on the fixture.
- Given `getManifest()`, then Mary/John/etc. appear as agents (with menus) and brainstorming/prd/etc. as skills.
- Given Mary's prompt built through the loader, then it is byte-equivalent to today's output (snapshot test).
- `npm run build` clean; `npm test` green; the live app's behavior is unchanged (pure groundwork).

## Design Notes

**Classification:** an "agent" = a `bmad-agent-*` (or any skill whose merged config has `[agent].menu`). Its menu items (`code`, `description`, `skill`/`prompt`) are the future command tree (Epic D). Manifest should surface them now so D can render the tree without new loader work.

**Keep it foundation:** no behavior change is the success signal. The payoff is C-2/C-3/C-4 consuming this.

## Verification

`npm run build` clean · `npm test` green (incl. Mary-equivalence snapshot) · No UX change in the running app.
