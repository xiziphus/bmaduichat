---
title: 'Playground v2 — Epic F: basic multi-user auth + private per-user data (flag-gated)'
type: 'feature'
created: '2026-07-16'
status: 'ready-for-dev'
baseline_commit: '4ff9f7a'
context:
  - '{project-root}/lib/auth.ts'
  - '{project-root}/middleware.ts'
  - '{project-root}/db/schema.sql'
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** Auth today is one shared password → an identical cookie for everyone, with NO data ownership (conversations have no `user_id`, so anyone logged in sees everything). The builder wants to hand accounts to a few people (Vee et al.), each with their own private space.

**Approach — keep it basic.** Behind an `AUTH_MODE` flag (`shared` default = byte-identical to today; `multi` = accounts): a `users` table with scrypt-hashed passwords + a role (`admin`|`user`). The **admin** (seeded once from env) creates accounts and hands over the id/password; **users can change their own password**; **admin can reset** a password (never view it). Conversations get a `user_id`; reads/writes scope to the logged-in user, so each person sees only their own work. No signup, no email, no extra hardening beyond the essentials. Ship dormant; flip `AUTH_MODE=multi` after a quick pass.

## Boundaries & Constraints

**Always:**
- **Flag-gated, default `shared`:** with `AUTH_MODE` unset/`shared`, the app is BYTE-IDENTICAL to today (single `PLAYGROUND_PASSWORD`, existing cookie, no user concept, DB-optional). Prove with a test. Multi-user code is inert in shared mode.
- **Users table:** `id`, `username` (unique, lowercased), `password_hash`, `role` (`admin`|`user`), `created`. **Passwords hashed with `node:crypto` scrypt** (built-in, no dep), per-user salt, stored self-describing (`scrypt$salt$hash`); verify constant-time. Never store/log plaintext.
- **Session:** on login issue a **signed cookie `{uid, role}`** — HMAC-signed with `AUTH_SECRET` via the SAME Web Crypto primitive as today, so middleware verifies on the edge without a DB hit. Keep `httpOnly; Secure; SameSite=Lax`.
- **Login:** `/api/auth` takes `{username, password}` in multi mode (`{password}` still works in shared). Look up by username → scrypt-verify → issue cookie. Simple "That's not it — try again?" on failure.
- **Change own password (any user):** `/api/account/password` `{current, next}` — verify current, min length (e.g. 8), set new hash, re-issue cookie. A small "change password" affordance in the UI.
- **Admin account management (role=admin only):**
  - `POST /api/admin/users {username, password?}` — create; if no password, auto-generate one; **return the plaintext ONCE** so the admin can hand it over.
  - `POST /api/admin/users/:id/reset {password?}` — set a new password (auto-generate if omitted), **return it once**. Admin resets, never reads an existing password.
  - `GET /api/admin/users` — list (username, role, created) — **never a hash**.
  - A minimal `/admin` page: list + create + reset (shows the one-time password).
- **Admin bootstrap:** on migration/first run in multi mode, if no admin exists, create one from `ADMIN_USERNAME` + `ADMIN_PASSWORD` env. The only account not made by the admin.
- **Private per-user data:** add `user_id uuid REFERENCES users(id)` to `conversations`; **backfill existing rows to the admin**. Scope to the session `uid`: conversation list, open/get, create (stamps `user_id`), artifacts (via conversation), `workflow_runs`/`run_events`, `builder_notes`, and **@refer** (a user @refers only their own conversations). Cross-user access → 404/empty. **Admin has NO read-all** — account management only.
- **Budget stays global:** the `$10` cap is the builder's single bill (not per-user).
- Server-only DB; auth on all routes; shared mode keeps today's DB-graceful behavior.

**Ask First:**
- Adding an admin read-all view (explicitly OUT).
- Any hashing dep beyond `node:crypto`.

**Never:**
- No public signup; accounts come from the admin (or the env bootstrap).
- No storing/logging plaintext; no returning a password except the one-time create/reset response.
- No regressing shared mode (default byte-identical, DB-optional).
- **Never touch `.env`.** Document `AUTH_MODE`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` in `.env.example` + `README.md` only.

## I/O & Edge-Case Matrix

| Scenario | State | Expected | Error |
|---|---|---|---|
| `AUTH_MODE` unset/shared | default | byte-identical to today | N/A |
| Multi, no DB | multi + no DATABASE_URL | clear "multi-user needs a database" error | N/A |
| Bootstrap | multi, no admin | admin created from env | env missing → clear error, stays shared |
| Admin creates user | POST users | row + one-time password returned | dup username → 409 |
| User logs in | username+password | authenticated, session cookie set | bad creds → simple reject |
| User changes password | correct current | hash updated, cookie re-issued | wrong current → reject |
| Admin resets user | POST reset | new one-time password returned | non-admin → 403 |
| Non-admin hits admin route | user role | 403 | N/A |
| User A opens B's conversation | A's session | 404 (isolation) | N/A |
| @refer another user's convo | A refers B's | not found / not offered | N/A |
| Existing data post-migration | pre-multi rows | owned by admin | N/A |
| Cookie tampered | edited uid/role | rejected in middleware → /login | N/A |

## Code Map

- `db/schema.sql` -- `users` table; `conversations.user_id` (ALTER ADD COLUMN IF NOT EXISTS) + index; backfill to admin
- `scripts/migrate.mjs` -- additive migration; admin bootstrap from env (multi + no admin)
- `lib/auth.ts` -- keep shared helpers; ADD `authMode()`, scrypt `hashPassword`/`verifyPassword`, signed-session `issueSession({uid,role})`/`verifySession(cookie)` (edge-safe)
- `lib/repo/users.ts` -- `findByUsername`, `getById`, `createUser`, `setPassword`, `list`, `countAdmins`, `ensureAdminFromEnv`
- `lib/session.ts` -- `currentUser(req)` → `{uid, role}` | null
- `middleware.ts` -- shared = today; multi = verify signed session (edge), redirect/401; keep `/login`, `/api/auth` public; gate `/admin` + `/api/admin/*` to admin
- `app/api/auth/route.ts` -- shared vs multi login
- `app/api/account/password/route.ts` -- change own password
- `app/api/admin/users/route.ts` + `app/api/admin/users/[id]/route.ts` -- create/list/reset (role-gated, one-time password)
- `lib/repo/conversations.ts` (+ artifacts/workflow-runs/builder-notes) -- `userId` scoping; `createConversation` stamps it
- `app/api/conversations/*`, `app/api/chat/route.ts`, `app/api/artifacts/[id]/route.ts`, `app/api/builder-notes/route.ts` -- scope by `currentUser`; @refer resolves only the caller's conversations
- `app/login/page.tsx` -- username+password in multi mode + a change-password affordance
- `app/admin/page.tsx` -- minimal admin panel
- `.env.example` / `README.md` -- new env + global-budget note
- tests -- hash/verify; session sign/verify + tamper; login shared vs multi; change-password (wrong current rejected); admin create/reset/list role-gating (non-admin 403); data isolation (A can't read B); backfill; flag-off byte-identical; migration idempotent

## Tasks & Acceptance

**Execution:**
- [ ] `db/schema.sql` + `scripts/migrate.mjs` -- users, conversations.user_id, backfill, bootstrap
- [ ] `lib/auth.ts` -- scrypt hash/verify + signed sessions + authMode
- [ ] `lib/repo/users.ts` + `lib/session.ts`
- [ ] `middleware.ts` -- multi session verify + admin gating (shared unchanged)
- [ ] `app/api/auth` + `app/api/account/password` + `app/api/admin/users[/id]`
- [ ] conversation/artifact/notes repos + routes -- user_id scoping + @refer scoping
- [ ] `app/login/page.tsx` + `app/admin/page.tsx`
- [ ] `.env.example` / `README.md`
- [ ] tests (above)

**Acceptance Criteria:**
- `AUTH_MODE` unset/shared → byte-identical to today (test-proven; DB-optional).
- `AUTH_MODE=multi` + DB → admin bootstrapped from env; admin creates a user and gets a one-time password; user logs in and can change their own password.
- Two users each see only their own conversations/docs/notes; cross-user access → not-found; admin cannot read others' chats.
- Admin can reset a user's password (one-time new password) but never view it; non-admins get 403 on admin routes.
- Post-migration, existing conversations are owned by the admin.
- Passwords scrypt-hashed + salted; sessions signed and reject tampering.
- `npm run build` clean; `npm test` green (incl. flag-off byte-identical + migration idempotent); `.env` untouched; shared mode unregressed. `AUTH_MODE` ships **shared**.

## Design Notes

**Basic, not bare.** Scrypt + a signed cookie + per-user scoping are the minimum-correct core, not extras — storing passwords as anything reversible or skipping isolation would be a real bug, not a simplification. Everything past that (rate-limiting, forced rotation, disable/delete, expiry, anti-enumeration) is intentionally left out for this small, invite-only tool.

**Isolation is the work; scope at the repo layer** so no route can forget the filter, and test cross-user access directly.

**Bootstrap once from env** (the admin can't be admin-created), then all accounts flow from the admin. Ship behind `AUTH_MODE=shared`; the builder flips to `multi` + sets the admin env in Vercel when ready — no code change to go live.

## Verification

`npm run build` clean · `npm test` green (flag-off byte-identical, isolation, migration idempotent) · **In-app pass (AUTH_MODE=multi): admin bootstraps → creates a user (one-time password) → user logs in and changes their password → each user sees only their own conversations → admin resets a user (one-time password) without viewing it → non-admin blocked from /admin.** Shared mode (default) unchanged. `.env` untouched.
