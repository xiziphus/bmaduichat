-- Playground v2 schema (Epic A).
-- Full runtime-shaped schema from the PRD addendum: conversations + messages are
-- wired this story; artifacts has a stub accessor; the rest sit empty for later
-- phases (C reuses them, so no later migration is needed).
--
-- Every statement is idempotent (IF NOT EXISTS) so `npm run db:migrate` can run
-- repeatedly against the same Neon branch. gen_random_uuid() is core Postgres 13+
-- (Neon is PG15+), so no extension is required.

CREATE TABLE IF NOT EXISTS conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text,
  agent_slug text NOT NULL DEFAULT 'mary',
  created    timestamptz NOT NULL DEFAULT now(),
  archived   boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS conversations_active_idx
  ON conversations (archived, created DESC);

-- Multi-user auth (Epic F). Inert in shared mode (AUTH_MODE unset/shared): the
-- app never reads these, so adding them changes nothing about today's behavior.
-- Passwords are scrypt-hashed and stored self-describing (`scrypt$salt$hash`) by
-- the app — never in the clear. username is unique + lowercased by the app.
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created       timestamptz NOT NULL DEFAULT now()
);

-- Per-user ownership of conversations. Nullable + additive so shared-mode rows
-- (and pre-migration rows) are untouched; multi-mode migration backfills existing
-- rows to the admin (see scripts/migrate.mjs). Every child record (messages,
-- artifacts, workflow_runs, run_events, builder_notes) is scoped VIA its owning
-- conversation, so this single column carries per-user isolation.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users (id);

CREATE INDEX IF NOT EXISTS conversations_user_idx
  ON conversations (user_id, archived, created DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text NOT NULL,
  chips_json      jsonb,
  -- Lightweight attachment metadata only (filename/mimeType/size) — never the
  -- binary. Populated by Epic E's multimodal composer; null for text-only turns.
  attachments     jsonb,
  -- Monotonic insertion order. `created` (now()) is the transaction-start time,
  -- so two rows inserted in one transaction share a timestamp; `seq` gives each
  -- row a distinct, ordered value so a thread always sorts user-before-assistant.
  seq             bigint GENERATED ALWAYS AS IDENTITY,
  created         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_idx
  ON messages (conversation_id, seq);

CREATE TABLE IF NOT EXISTS artifacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  run_id          uuid,
  title           text,
  kind            text,
  markdown        text,
  html            text,
  version         integer NOT NULL DEFAULT 1,
  created         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artifacts_conversation_idx
  ON artifacts (conversation_id, created);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  skill_slug      text,
  status          text NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'awaiting_user', 'done', 'failed')),
  phase           text,
  state_json      jsonb,
  created         timestamptz NOT NULL DEFAULT now(),
  updated         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_events (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id  uuid NOT NULL REFERENCES workflow_runs (id) ON DELETE CASCADE,
  type    text NOT NULL,
  text    text,
  by      text,
  created timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS run_events_run_idx
  ON run_events (run_id, created);

CREATE TABLE IF NOT EXISTS builder_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations (id) ON DELETE CASCADE,
  excerpt         text NOT NULL,
  status          text NOT NULL DEFAULT 'collected'
                    CHECK (status IN ('collected', 'sent')),
  created         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider   text,
  model      text,
  tokens_in  integer,
  tokens_out integer,
  cost_est   numeric,
  created    timestamptz NOT NULL DEFAULT now()
);
