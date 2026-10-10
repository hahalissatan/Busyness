-- 001_create_users_businesses.sql
-- Tables: users, businesses, business_memberships
-- Also creates the reusable update_updated_at() trigger function.
-- Requires: pgcrypto extension (for gen_random_uuid on PG < 13)

-- Ensure gen_random_uuid() is available (built-in on PG 13+, extension on older)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===================================================================
-- Reusable trigger function: sets updated_at = now() on any UPDATE
-- ===================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===================================================================
-- users: application users who can log in and belong to businesses
-- ===================================================================
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===================================================================
-- businesses: root entity for all business-scoped data
-- ===================================================================
CREATE TABLE businesses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  currency   TEXT NOT NULL DEFAULT 'MYR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===================================================================
-- business_memberships: many-to-many users <-> businesses with role
-- ===================================================================
CREATE TABLE business_memberships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, business_id)
);

CREATE INDEX idx_bm_user_id     ON business_memberships(user_id);
CREATE INDEX idx_bm_business_id ON business_memberships(business_id);
