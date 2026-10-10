-- 006_create_agent_infra.sql
-- Tables: agent_runs (with retry_of), agent_run_steps, approval_requests, audit_logs
-- Also: ALTER TABLE tasks ADD COLUMN agent_run_id (forward FK resolved here)
--       Partial unique index on tasks for agent-created tasks

-- ===================================================================
-- agent_runs: top-level agent execution record (one per user goal)
-- retry_of: self-referencing FK for retry tracking
-- ===================================================================
CREATE TABLE agent_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  goal         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'planning', 'executing', 'awaiting_approval', 'completed', 'failed', 'cancelled')),
  plan         JSONB,
  final_report JSONB,
  retry_of     UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON agent_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_agent_runs_business_status ON agent_runs(business_id, status);
CREATE INDEX idx_agent_runs_user             ON agent_runs(user_id);

-- ===================================================================
-- agent_run_steps: individual steps within an agent run
-- ===================================================================
CREATE TABLE agent_run_steps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  agent_type   TEXT NOT NULL
               CHECK (agent_type IN ('coordinator', 'financial', 'inventory', 'task_allocation', 'marketing', 'qa')),
  step_number  INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'executing', 'completed', 'failed', 'skipped')),
  input        JSONB,
  output       JSONB,
  evidence     JSONB,
  error        TEXT,
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_run_id, step_number)
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON agent_run_steps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_agent_run_steps_run_step ON agent_run_steps(agent_run_id, step_number);

-- ===================================================================
-- approval_requests: approval gates for consequential agent actions
-- ===================================================================
CREATE TABLE approval_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id      UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  agent_run_step_id UUID NOT NULL REFERENCES agent_run_steps(id) ON DELETE CASCADE,
  action_type       TEXT NOT NULL,
  action_payload    JSONB NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  requested_by      TEXT NOT NULL,
  reviewed_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  review_notes      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_approval_requests_run_status ON approval_requests(agent_run_id, status);
CREATE INDEX idx_approval_requests_status      ON approval_requests(status);

-- ===================================================================
-- audit_logs: immutable audit trail (BIGSERIAL PK for ordering)
-- Append-only — trigger in migration 007 blocks UPDATE/DELETE
-- ===================================================================
CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   UUID,
  changes     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_business_created ON audit_logs(business_id, created_at);
CREATE INDEX idx_audit_logs_entity            ON audit_logs(entity_type, entity_id);

-- ===================================================================
-- Forward FK resolution: add agent_run_id to tasks
-- (tasks was created in migration 004 without this column because
--  agent_runs did not exist yet)
-- ===================================================================
ALTER TABLE tasks ADD COLUMN agent_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL;

CREATE INDEX idx_tasks_agent_run_id ON tasks(agent_run_id);

-- Partial unique index: prevents duplicate agent-created tasks
-- (same agent run cannot create two tasks with the same title)
CREATE UNIQUE INDEX idx_tasks_agent_unique
  ON tasks(business_id, agent_run_id, title)
  WHERE source = 'agent';
