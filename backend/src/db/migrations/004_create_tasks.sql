-- 004_create_tasks.sql
-- Tables: employees, skills, employee_skills, tasks (WITHOUT agent_run_id), task_assignments
-- Note: tasks.agent_run_id is added in migration 006 via ALTER TABLE
--       (forward FK reference — agent_runs table does not exist yet)

-- ===================================================================
-- employees: employee profiles for task allocation
-- ===================================================================
CREATE TABLE employees (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name               TEXT NOT NULL,
  email              TEXT,
  phone              TEXT,
  role               TEXT NOT NULL CHECK (role IN ('manager', 'staff', 'contractor')),
  availability       TEXT NOT NULL DEFAULT 'available'
                     CHECK (availability IN ('available', 'busy', 'unavailable', 'on_leave')),
  max_workload_hours INTEGER NOT NULL DEFAULT 40 CHECK (max_workload_hours > 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_employees_business_avail ON employees(business_id, availability);

-- ===================================================================
-- skills: shared catalog across all businesses
-- ===================================================================
CREATE TABLE skills (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE
);

-- ===================================================================
-- employee_skills: many-to-many with proficiency level
-- Composite primary key (no separate id column)
-- ===================================================================
CREATE TABLE employee_skills (
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  skill_id    UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  proficiency TEXT NOT NULL DEFAULT 'intermediate'
              CHECK (proficiency IN ('beginner', 'intermediate', 'advanced', 'expert')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, skill_id)
);

-- ===================================================================
-- tasks: created manually or by agents
-- agent_run_id is NOT here — added in migration 006 via ALTER TABLE
-- ===================================================================
CREATE TABLE tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  title           TEXT NOT NULL,
  description     TEXT,
  priority        TEXT NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  deadline        TIMESTAMPTZ,
  estimated_hours NUMERIC(5,1),
  source          TEXT NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual', 'agent')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_tasks_business_status_priority ON tasks(business_id, status, priority);
CREATE INDEX idx_tasks_business_deadline        ON tasks(business_id, deadline);

-- ===================================================================
-- task_assignments: links tasks to employees
-- Partial unique index prevents duplicate active assignments
-- ===================================================================
CREATE TABLE task_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'completed', 'reassigned')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active assignment per task+employee
CREATE UNIQUE INDEX idx_task_assignments_active_unique
  ON task_assignments(task_id, employee_id)
  WHERE status = 'active';

CREATE INDEX idx_task_assignments_employee_status ON task_assignments(employee_id, status);
CREATE INDEX idx_task_assignments_task            ON task_assignments(task_id);
