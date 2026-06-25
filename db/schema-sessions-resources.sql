-- db/schema-sessions-resources.sql
-- ---------------------------------------------------------------------------
-- Adds real, client-specific session history and resources, replacing the
-- dashboard's remaining static mockup panels. Same flexible-per-client
-- pattern as milestones (db/schema-clients.sql) — no fixed count, admin
-- adds/removes freely per client. Run once in Vercel's Query tab (or
-- Neon's SQL editor). Safe to re-run.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  topic TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  heading TEXT NOT NULL,     -- e.g. "Before our next session", "Reading", "Reminder"
  body TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_client_id ON sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_resources_client_id ON resources(client_id);
