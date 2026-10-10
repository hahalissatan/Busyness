-- 005_create_marketing.sql
-- Tables: marketing_projects, customer_personas, marketing_drafts, pitch_decks

-- ===================================================================
-- marketing_projects: container for marketing work
-- ===================================================================
CREATE TABLE marketing_projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'active', 'completed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON marketing_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===================================================================
-- customer_personas: AI-generated or manually created personas
-- ===================================================================
CREATE TABLE customer_personas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  marketing_project_id UUID REFERENCES marketing_projects(id) ON DELETE SET NULL,
  name                 TEXT NOT NULL,
  description          TEXT,
  pain_points          TEXT,
  motivations          TEXT,
  target_segment       TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON customer_personas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===================================================================
-- marketing_drafts: generated content drafts
-- ===================================================================
CREATE TABLE marketing_drafts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  marketing_project_id UUID REFERENCES marketing_projects(id) ON DELETE SET NULL,
  draft_type           TEXT NOT NULL
                       CHECK (draft_type IN ('social_media', 'campaign', 'content', 'email')),
  title                TEXT NOT NULL,
  content              TEXT NOT NULL,
  platform             TEXT,
  status               TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'reviewed', 'approved', 'published')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON marketing_drafts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===================================================================
-- pitch_decks: 10-slide pitch deck outlines as structured JSON
-- ===================================================================
CREATE TABLE pitch_decks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  title       TEXT NOT NULL,
  slides      JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'reviewed', 'finalized')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON pitch_decks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
