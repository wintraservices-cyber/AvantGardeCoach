-- db/schema-notion-sync.sql
-- ---------------------------------------------------------------------------
-- Adds the linking column each table needs for two-way Notion sync: the ID
-- of the matching Notion page, so our backend can find "the Notion page for
-- this Postgres row" (outbound writes) and the inbound webhook can find
-- "the Postgres row for this Notion page" (inbound writes), without ever
-- guessing by name/content matching.
--
-- Nullable, since rows created before this sync existed won't have a
-- Notion page yet — the first sync pass (or the next edit) is what
-- creates one and backfills this column.
-- ---------------------------------------------------------------------------

ALTER TABLE clients ADD COLUMN IF NOT EXISTS notion_page_id TEXT;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS notion_page_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS notion_page_id TEXT;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS notion_page_id TEXT;

-- For last-write-wins conflict resolution, we need to know when each row
-- was last touched. clients/milestones/sessions/resources don't currently
-- track this at all (only `clients.created_at` exists, and only for
-- creation, not updates).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE resources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_clients_notion_page_id ON clients(notion_page_id);
CREATE INDEX IF NOT EXISTS idx_milestones_notion_page_id ON milestones(notion_page_id);
CREATE INDEX IF NOT EXISTS idx_sessions_notion_page_id ON sessions(notion_page_id);
CREATE INDEX IF NOT EXISTS idx_resources_notion_page_id ON resources(notion_page_id);

-- ---------------------------------------------------------------------------
-- AUTO-UPDATING updated_at
--
-- Postgres' DEFAULT now() only applies on INSERT, never on UPDATE — so
-- without this trigger, updated_at would silently stay frozen at creation
-- time forever, and "last write wins" would have no reliable timestamp to
-- compare. Rather than rely on every UPDATE statement in _db.js
-- remembering to set updated_at = now() by hand (one missed spot, now or
-- in some future edit, and the whole conflict-resolution mechanism breaks
-- silently), a trigger guarantees it automatically at the database level.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clients_updated_at ON clients;
CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS trg_milestones_updated_at ON milestones;
CREATE TRIGGER trg_milestones_updated_at
  BEFORE UPDATE ON milestones
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS trg_sessions_updated_at ON sessions;
CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS trg_resources_updated_at ON resources;
CREATE TRIGGER trg_resources_updated_at
  BEFORE UPDATE ON resources
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
