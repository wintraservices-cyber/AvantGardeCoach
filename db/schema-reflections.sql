-- db/schema-reflections.sql
-- ---------------------------------------------------------------------------
-- Adds storage for a client's own reflection text and the AI's follow-up
-- question, on the milestones table — one reflection per milestone,
-- overwritable, matching the "keep it simple" design decision (not a
-- separate running-log table).
--
-- PRIVACY NOTE: reflection_text is personal, often sensitive content the
-- client wrote about their own situation — not ordinary site content like
-- a program description. It is intentionally:
--   - never editable by an admin (read-only in the Control Panel — admins
--     can see it to prepare for sessions, but cannot rewrite what a
--     client wrote)
--   - deletable by the client themselves (see api/client-data.js)
--   - NOT synced to Notion (the two-way sync built earlier in this
--     project deliberately excludes these two columns — see
--     api/_notion.js's buildMilestoneProperties, which does not
--     reference reflection_text or reflection_followup at all)
-- ---------------------------------------------------------------------------

ALTER TABLE milestones ADD COLUMN IF NOT EXISTS reflection_text TEXT;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS reflection_followup TEXT;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS reflection_saved_at TIMESTAMPTZ;
