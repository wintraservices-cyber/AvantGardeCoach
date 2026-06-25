-- db/schema-clients.sql
-- ---------------------------------------------------------------------------
-- Adds real client accounts and their milestones, replacing the dashboard's
-- static mockup data. Run this once in Vercel's Query tab (or Neon's SQL
-- editor) — same place you ran the earlier schema files. Safe to re-run.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  session_count INTEGER NOT NULL DEFAULT 0,
  hero_headline TEXT, -- e.g. "Three sessions in. The thread is coming back."
  next_session_at TIMESTAMPTZ,
  next_session_with TEXT DEFAULT 'Mahal Hudson',
  next_session_format TEXT DEFAULT 'Video call',
  reschedule_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Each milestone belongs to exactly one client. sort_order controls display
-- order (matches the "journey path" sequence in the dashboard UI).
CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tag TEXT,                  -- e.g. "Standing Question I"
  title TEXT NOT NULL,       -- e.g. "Naming the decision you've been circling"
  description TEXT,
  status TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('complete', 'active', 'locked')),
  locked_reason TEXT,        -- e.g. "Unlocks after Session 4" — shown only when status = 'locked'
  reflection_prompt TEXT,    -- the question shown above the journal textarea
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_milestones_client_id ON milestones(client_id);
