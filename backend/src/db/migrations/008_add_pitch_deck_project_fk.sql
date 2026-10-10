-- 008_add_pitch_deck_project_fk.sql
-- Forward-only migration: add nullable marketing_project_id to pitch_decks.
-- Resolves the schema gap where pitch_decks were only linked to business_id.
-- Existing pitch decks will have marketing_project_id = NULL (preserved, not lost).

ALTER TABLE pitch_decks
  ADD COLUMN IF NOT EXISTS marketing_project_id UUID
    REFERENCES marketing_projects(id) ON DELETE SET NULL;

-- Index for efficient project-scoped queries (partial — only non-null)
CREATE INDEX IF NOT EXISTS idx_pitch_decks_marketing_project_id
  ON pitch_decks (marketing_project_id)
  WHERE marketing_project_id IS NOT NULL;
