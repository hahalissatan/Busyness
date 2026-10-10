# Busyness — Database Design & PostgreSQL Setup Plan

**Status:** Approved with changes (see Design Verification below).

---

## Task 1: Database Approach

### Database: PostgreSQL

PostgreSQL is the recommended database. Rationale:

- Native `NUMERIC` type for exact monetary calculations (no floating-point drift).
- `JSONB` for agent run plans, step outputs, and audit log changes.
- `gen_random_uuid()` for UUID primary keys without application-side ID generation.
- CHECK constraints for status enums, preventing invalid states at the database level.
- Mature, free, well-documented, and runs locally or via Docker.

No aspect of the existing architecture document contradicts this choice.

### Client: `pg` (node-postgres) — raw SQL, no ORM

| Aspect                 | `pg` (raw SQL)                   | Prisma (ORM)                                            |
| ---------------------- | -------------------------------- | ------------------------------------------------------- |
| Learning curve         | Low — team writes SQL directly   | Medium — schema language, generated client              |
| Financial calculations | Full SQL control, no abstraction | Prisma shields SQL; raw queries needed for complex sums |
| Migration tooling      | Bring your own (node-pg-migrate) | Built-in                                                |
| Type safety            | Manual (or via shared types)     | Auto-generated                                          |
| Speed of setup         | Fast — one dependency            | Slower — generate, configure                            |
| Hackathon fit          | Better — predictable, no magic   | Heavier; harder to debug under time pressure            |

**Recommendation:** Use `pg` with `node-pg-migrate` for migrations. This gives full SQL control for financial and inventory calculations, keeps dependencies minimal, and is easy for every team member to understand.

---

## Task 2: Shared Schema Design

### Conventions

- **Primary keys:** `UUID` with `DEFAULT gen_random_uuid()` on every table.
- **Timestamps:** `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` on every table; `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` on mutable tables (updated via trigger).
- **Money:** `NUMERIC(12,2)` — supports up to 999,999,999.99. Never `FLOAT`, `REAL`, or `DOUBLE`.
- **Business ownership:** Every business-scoped table has `business_id UUID NOT NULL REFERENCES businesses(id)`. This is the authorization boundary.
- **Soft deletes:** Not used in MVP. Deletion is explicit and controlled by foreign key rules.
- **Status enums:** CHECK constraints, not native enum types (simpler to migrate).

### Updated_at trigger

A single reusable trigger function updates `updated_at` on any row modification:

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Applied per-table: `CREATE TRIGGER set_updated_at BEFORE UPDATE ON <table> FOR EACH ROW EXECUTE FUNCTION update_updated_at();`

---

### Table 1: `users`

**Purpose:** Application users who can log in and belong to businesses.

| Column        | Type        | Constraints                                             |
| ------------- | ----------- | ------------------------------------------------------- |
| id            | UUID        | PK, DEFAULT gen_random_uuid()                           |
| email         | TEXT        | NOT NULL, UNIQUE                                        |
| password_hash | TEXT        | NOT NULL                                                |
| name          | TEXT        | NOT NULL                                                |
| role          | TEXT        | NOT NULL, CHECK (role IN ('owner', 'manager', 'staff')) |
| created_at    | TIMESTAMPTZ | NOT NULL DEFAULT now()                                  |
| updated_at    | TIMESTAMPTZ | NOT NULL DEFAULT now()                                  |

**Indexes:** unique on `email`.

---

### Table 2: `businesses`

**Purpose:** Business entities (SMBs). The root of all business-scoped data.

| Column     | Type        | Constraints                   |
| ---------- | ----------- | ----------------------------- |
| id         | UUID        | PK, DEFAULT gen_random_uuid() |
| name       | TEXT        | NOT NULL                      |
| currency   | TEXT        | NOT NULL DEFAULT 'MYR'        |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now()        |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now()        |

---

### Table 3: `business_memberships`

**Purpose:** Many-to-many link between users and businesses with a role.

| Column      | Type        | Constraints                                             |
| ----------- | ----------- | ------------------------------------------------------- |
| id          | UUID        | PK, DEFAULT gen_random_uuid()                           |
| user_id     | UUID        | NOT NULL, REFERENCES users(id) ON DELETE CASCADE        |
| business_id | UUID        | NOT NULL, REFERENCES businesses(id) ON DELETE CASCADE   |
| role        | TEXT        | NOT NULL, CHECK (role IN ('owner', 'manager', 'staff')) |
| created_at  | TIMESTAMPTZ | NOT NULL DEFAULT now()                                  |

**Constraints:** UNIQUE(user_id, business_id) — a user has exactly one role per business.

**Indexes:** on `user_id`, on `business_id`.

---

### Table 4: `customers`

**Purpose:** Business customers (recipients of invoices).

| Column      | Type        | Constraints                                            |
| ----------- | ----------- | ------------------------------------------------------ |
| id          | UUID        | PK, DEFAULT gen_random_uuid()                          |
| business_id | UUID        | NOT NULL, REFERENCES businesses(id) ON DELETE RESTRICT |
| name        | TEXT        | NOT NULL                                               |
| email       | TEXT        |                                                        |
| phone       | TEXT        |                                                        |
| address     | TEXT        |                                                        |
| created_at  | TIMESTAMPTZ | NOT NULL DEFAULT now()                                 |
| updated_at  | TIMESTAMPTZ | NOT NULL DEFAULT now()                                 |

**Indexes:** on `(business_id, name)`, on `(business_id)`.

---

### Table 5: `invoices`

**Purpose:** Invoices with calculated totals. Outstanding balance = total - SUM(payments.amount).

| Column          | Type          | Constraints                                                                                          |
| --------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| id              | UUID          | PK, DEFAULT gen_random_uuid()                                                                        |
| business_id     | UUID          | NOT NULL, REFERENCES businesses(id) ON DELETE RESTRICT                                               |
| customer_id     | UUID          | NOT NULL, REFERENCES customers(id) ON DELETE RESTRICT                                                |
| invoice_number  | TEXT          | NOT NULL                                                                                             |
| status          | TEXT          | NOT NULL DEFAULT 'draft', CHECK (status IN ('draft', 'unpaid', 'partially_paid', 'paid', 'overdue')) |
| issue_date      | DATE          | NOT NULL                                                                                             |
| due_date        | DATE          | NOT NULL, CHECK (due_date >= issue_date)                                                             |
| subtotal        | NUMERIC(12,2) | NOT NULL DEFAULT 0, CHECK (subtotal >= 0)                                                            |
| tax_amount      | NUMERIC(12,2) | NOT NULL DEFAULT 0, CHECK (tax_amount >= 0)                                                          |
| discount_amount | NUMERIC(12,2) | NOT NULL DEFAULT 0, CHECK (discount_amount >= 0)                                                     |
| total           | NUMERIC(12,2) | NOT NULL DEFAULT 0, CHECK (total >= 0)                                                               |
| notes           | TEXT          |                                                                                                      |
| created_at      | TIMESTAMPTZ   | NOT NULL DEFAULT now()                                                                               |
| updated_at      | TIMESTAMPTZ   | NOT NULL DEFAULT now()                                                                               |

**Constraints:** UNIQUE(business_id, invoice_number) — invoice numbers are unique per business.

**Indexes:** on `(business_id, status)`, on `(business_id, due_date)`, on `(customer_id)`.

**Outstanding balance calculation (backend service, not a column):**

```sql
SELECT i.total - COALESCE(SUM(p.amount), 0) AS outstanding
FROM invoices i
LEFT JOIN payments p ON p.invoice_id = i.id
WHERE i.id = $1
GROUP BY i.id;
```

**Status transition rules (enforced in backend service layer):**

- `draft` -> `unpaid` (when issued)
- `unpaid` -> `partially_paid` (when a payment < total is recorded)
- `unpaid` / `partially_paid` -> `paid` (when outstanding = 0)
- `unpaid` / `partially_paid` -> `overdue` (when past due_date and outstanding > 0)
- `overdue` -> `partially_paid` / `paid` (when payments are recorded)

---

### Table 6: `invoice_items`

**Purpose:** Line items on an invoice. Line totals are calculated and stored for audit.

| Column          | Type          | Constraints                                                   |
| --------------- | ------------- | ------------------------------------------------------------- |
| id              | UUID          | PK, DEFAULT gen_random_uuid()                                 |
| invoice_id      | UUID          | NOT NULL, REFERENCES invoices(id) ON DELETE CASCADE           |
| description     | TEXT          | NOT NULL                                                      |
| quantity        | NUMERIC(10,2) | NOT NULL, CHECK (quantity > 0)                                |
| unit_price      | NUMERIC(12,2) | NOT NULL, CHECK (unit_price >= 0)                             |
| tax_rate        | NUMERIC(5,2)  | NOT NULL DEFAULT 0, CHECK (tax_rate >= 0 AND tax_rate <= 100) |
| discount_amount | NUMERIC(12,2) | NOT NULL DEFAULT 0, CHECK (discount_amount >= 0)              |
| line_total      | NUMERIC(12,2) | NOT NULL DEFAULT 0, CHECK (line_total >= 0)                   |
| sort_order      | INTEGER       | NOT NULL DEFAULT 0                                            |
| created_at      | TIMESTAMPTZ   | NOT NULL DEFAULT now()                                        |
| updated_at      | TIMESTAMPTZ   | NOT NULL DEFAULT now()                                        |

**Line total formula (backend service):**  
`line_total = (quantity * unit_price) + (quantity * unit_price * tax_rate / 100) - discount_amount`

**Invoice total formula (backend service):**  
`subtotal = SUM(line_items.line_total_before_tax)`, `tax_amount = SUM(tax)`, `total = subtotal + tax_amount - discount_amount`

**Indexes:** on `(invoice_id, sort_order)`.

---

### Table 7: `payments`

**Purpose:** Payments recorded against invoices. Cannot be deleted (financial audit integrity).

| Column       | Type          | Constraints                                                                                           |
| ------------ | ------------- | ----------------------------------------------------------------------------------------------------- |
| id           | UUID          | PK, DEFAULT gen_random_uuid()                                                                         |
| invoice_id   | UUID          | NOT NULL, REFERENCES invoices(id) ON DELETE RESTRICT                                                  |
| business_id  | UUID          | NOT NULL, REFERENCES businesses(id) ON DELETE RESTRICT                                                |
| amount       | NUMERIC(12,2) | NOT NULL, CHECK (amount > 0)                                                                          |
| payment_date | DATE          | NOT NULL                                                                                              |
| method       | TEXT          | NOT NULL, CHECK (method IN ('cash', 'bank_transfer', 'credit_card', 'debit_card', 'cheque', 'other')) |
| reference    | TEXT          |                                                                                                       |
| created_at   | TIMESTAMPTZ   | NOT NULL DEFAULT now()                                                                                |

**Delete behavior:** `ON DELETE RESTRICT` on invoice_id — cannot delete an invoice that has payments. This protects financial audit integrity.

**Indexes:** on `(invoice_id)`, on `(business_id, payment_date)`.

---

### Table 8: `suppliers`

**Purpose:** Supplier information for inventory replenishment.

| Column       | Type        | Constraints                                            |
| ------------ | ----------- | ------------------------------------------------------ |
| id           | UUID        | PK, DEFAULT gen_random_uuid()                          |
| business_id  | UUID        | NOT NULL, REFERENCES businesses(id) ON DELETE RESTRICT |
| name         | TEXT        | NOT NULL                                               |
| contact_name | TEXT        |                                                        |
| email        | TEXT        |                                                        |
| phone        | TEXT        |                                                        |
| address      | TEXT        |                                                        |
| created_at   | TIMESTAMPTZ | NOT NULL DEFAULT now()                                 |
| updated_at   | TIMESTAMPTZ | NOT NULL DEFAULT now()                                 |

**Indexes:** on `(business_id, name)`.

---

### Table 9: `products`

**Purpose:** Inventory items with stock level tracking.

| Column              | Type          | Constraints                                            |
| ------------------- | ------------- | ------------------------------------------------------ |
| id                  | UUID          | PK, DEFAULT gen_random_uuid()                          |
| business_id         | UUID          | NOT NULL, REFERENCES businesses(id) ON DELETE RESTRICT |
| name                | TEXT          | NOT NULL                                               |
| sku                 | TEXT          | NOT NULL                                               |
| description         | TEXT          |                                                        |
| stock_quantity      | NUMERIC(10,2) | NOT NULL DEFAULT 0, CHECK (stock_quantity >= 0)        |
| min_stock_threshold | NUMERIC(10,2) | NOT NULL DEFAULT 0, CHECK (min_stock_threshold >= 0)   |
| unit_cost           | NUMERIC(12,2) | NOT NULL DEFAULT 0, CHECK (unit_cost >= 0)             |
| expiry_date         | DATE          | (nullable — not all products expire)                   |
| supplier_id         | UUID          | REFERENCES suppliers(id) ON DELETE SET NULL            |
| is_active           | BOOLEAN       | NOT NULL DEFAULT TRUE                                  |
| created_at          | TIMESTAMPTZ   | NOT NULL DEFAULT now()                                 |
| updated_at          | TIMESTAMPTZ   | NOT NULL DEFAULT now()                                 |


**Constraints:** UNIQUE(business_id, sku) — SKUs are unique per business.

**Indexes:** on `(business_id, is_active)`, on `(business_id, stock_quantity)` for low-stock queries, on `(business_id, expiry_date)` for expiry queries.

**Stock consistency:** `products.stock_quantity` must equal `SUM(stock_movements.quantity_change)` for that product. Enforced via a database trigger after each stock movement insert, or via a backend transaction that inserts the movement and updates the product in the same transaction.

---

### Table 10: `stock_movements` (append-only)

**Purpose:** Complete history of all stock changes. Never UPDATE or DELETE rows.

| Column          | Type          | Constraints                                                                                             |
| --------------- | ------------- | ------------------------------------------------------------------------------------------------------- |
| id              | UUID          | PK, DEFAULT gen_random_uuid()                                                                           |
| product_id      | UUID          | NOT NULL, REFERENCES products(id) ON DELETE RESTRICT                                                    |
| business_id     | UUID          | NOT NULL, REFERENCES businesses(id) ON DELETE RESTRICT                                                  |
| movement_type   | TEXT          | NOT NULL, CHECK (movement_type IN ('purchase', 'sale', 'adjustment', 'return', 'transfer', 'writeoff')) |
| quantity_change | NUMERIC(10,2) | NOT NULL (positive = stock in, negative = stock out)                                                    |
| reason          | TEXT          |                                                                                                         |
| reference_type  | TEXT          | (nullable — e.g., 'invoice', 'manual', 'agent')                                                         |
| reference_id    | UUID          | (nullable — links to the originating record)                                                            |
| created_at      | TIMESTAMPTZ   | NOT NULL DEFAULT now()                                                                                  |

**Append-only enforcement:** A trigger raises an exception on UPDATE or DELETE.

**Indexes:** on `(product_id, created_at)` for movement history, on `(business_id, created_at)` for audit, on `(reference_type, reference_id)`.

---

### Table 11: `employees`

**Purpose:** Employee profiles for task allocation.

| Column             | Type        | Constraints                                                                                            |
| ------------------ | ----------- | ------------------------------------------------------------------------------------------------------ |
| id                 | UUID        | PK, DEFAULT gen_random_uuid()                                                                          |
| business_id        | UUID        | NOT NULL, REFERENCES businesses(id) ON DELETE RESTRICT                                                 |
| name               | TEXT        | NOT NULL                                                                                               |
| email              | TEXT        |                                                                                                        |
| phone              | TEXT        |                                                                                                        |
| role               | TEXT        | NOT NULL, CHECK (role IN ('manager', 'staff', 'contractor'))                                           |
| availability       | TEXT        | NOT NULL DEFAULT 'available', CHECK (availability IN ('available', 'busy', 'unavailable', 'on_leave')) |
| max_workload_hours | INTEGER     | NOT NULL DEFAULT 40, CHECK (max_workload_hours > 0)                                                    |
| created_at         | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                                                 |
| updated_at         | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                                                 |

**Indexes:** on `(business_id, availability)`.

---

### Table 12: `skills`

**Purpose:** Skill catalog shared across businesses.

| Column | Type | Constraints                   |
| ------ | ---- | ----------------------------- |
| id     | UUID | PK, DEFAULT gen_random_uuid() |
| name   | TEXT | NOT NULL, UNIQUE              |

---

### Table 13: `employee_skills`

**Purpose:** Many-to-many link between employees and skills with proficiency level.

| Column      | Type        | Constraints                                                                                                |
| ----------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| employee_id | UUID        | NOT NULL, REFERENCES employees(id) ON DELETE CASCADE                                                       |
| skill_id    | UUID        | NOT NULL, REFERENCES skills(id) ON DELETE CASCADE                                                          |
| proficiency | TEXT        | NOT NULL DEFAULT 'intermediate', CHECK (proficiency IN ('beginner', 'intermediate', 'advanced', 'expert')) |
| created_at  | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                                                     |

**Primary key:** Composite (employee_id, skill_id).

---

### Table 14: `tasks`

**Purpose:** Tasks that can be created manually or by agents.

| Column          | Type         | Constraints                                                                                        |
| --------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| id              | UUID         | PK, DEFAULT gen_random_uuid()                                                                      |
| business_id     | UUID         | NOT NULL, REFERENCES businesses(id) ON DELETE RESTRICT                                             |
| title           | TEXT         | NOT NULL                                                                                           |
| description     | TEXT         |                                                                                                    |
| priority        | TEXT         | NOT NULL DEFAULT 'medium', CHECK (priority IN ('low', 'medium', 'high', 'urgent'))                 |
| status          | TEXT         | NOT NULL DEFAULT 'pending', CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')) |
| deadline        | TIMESTAMPTZ  | (nullable)                                                                                         |
| estimated_hours | NUMERIC(5,1) | (nullable)                                                                                         |
| source          | TEXT         | NOT NULL DEFAULT 'manual', CHECK (source IN ('manual', 'agent'))                                   |
| agent_run_id    | UUID         | (nullable, REFERENCES agent_runs(id) ON DELETE SET NULL)                                           |
| created_at      | TIMESTAMPTZ  | NOT NULL DEFAULT now()                                                                             |
| updated_at      | TIMESTAMPTZ  | NOT NULL DEFAULT now()                                                                             |

**Indexes:** on `(business_id, status, priority)`, on `(business_id, deadline)`, on `(agent_run_id)`.

---

### Table 15: `task_assignments`

**Purpose:** Links tasks to employees. One active assignment per task per employee.

| Column      | Type        | Constraints                                                                        |
| ----------- | ----------- | ---------------------------------------------------------------------------------- |
| id          | UUID        | PK, DEFAULT gen_random_uuid()                                                      |
| task_id     | UUID        | NOT NULL, REFERENCES tasks(id) ON DELETE CASCADE                                   |
| employee_id | UUID        | NOT NULL, REFERENCES employees(id) ON DELETE CASCADE                               |
| assigned_at | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                             |
| status      | TEXT        | NOT NULL DEFAULT 'active', CHECK (status IN ('active', 'completed', 'reassigned')) |
| created_at  | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                             |

**Constraints:** Partial unique index: `UNIQUE(task_id, employee_id) WHERE status = 'active'` — prevents duplicate active assignments.

**Indexes:** on `(employee_id, status)` for workload queries, on `(task_id)`.

---

### Table 16: `marketing_projects`

**Purpose:** Container for marketing work (personas, drafts, campaigns).

| Column      | Type        | Constraints                                                                  |
| ----------- | ----------- | ---------------------------------------------------------------------------- |
| id          | UUID        | PK, DEFAULT gen_random_uuid()                                                |
| business_id | UUID        | NOT NULL, REFERENCES businesses(id) ON DELETE RESTRICT                       |
| name        | TEXT        | NOT NULL                                                                     |
| description | TEXT        |                                                                              |
| status      | TEXT        | NOT NULL DEFAULT 'draft', CHECK (status IN ('draft', 'active', 'completed')) |
| created_at  | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                       |
| updated_at  | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                       |

---

### Table 17: `customer_personas`

**Purpose:** AI-generated or manually created customer personas.

| Column               | Type        | Constraints                                                      |
| -------------------- | ----------- | ---------------------------------------------------------------- |
| id                   | UUID        | PK, DEFAULT gen_random_uuid()                                    |
| business_id          | UUID        | NOT NULL, REFERENCES businesses(id) ON DELETE RESTRICT           |
| marketing_project_id | UUID        | (nullable, REFERENCES marketing_projects(id) ON DELETE SET NULL) |
| name                 | TEXT        | NOT NULL                                                         |
| description          | TEXT        |                                                                  |
| pain_points          | TEXT        |                                                                  |
| motivations          | TEXT        |                                                                  |
| target_segment       | TEXT        |                                                                  |
| created_at           | TIMESTAMPTZ | NOT NULL DEFAULT now()                                           |
| updated_at           | TIMESTAMPTZ | NOT NULL DEFAULT now()                                           |

---

### Table 18: `marketing_drafts`

**Purpose:** Generated marketing content drafts (social media, campaigns, etc.).

| Column               | Type        | Constraints                                                                                |
| -------------------- | ----------- | ------------------------------------------------------------------------------------------ |
| id                   | UUID        | PK, DEFAULT gen_random_uuid()                                                              |
| business_id          | UUID        | NOT NULL, REFERENCES businesses(id) ON DELETE RESTRICT                                     |
| marketing_project_id | UUID        | (nullable, REFERENCES marketing_projects(id) ON DELETE SET NULL)                           |
| draft_type           | TEXT        | NOT NULL, CHECK (draft_type IN ('social_media', 'campaign', 'content', 'email'))           |
| title                | TEXT        | NOT NULL                                                                                   |
| content              | TEXT        | NOT NULL                                                                                   |
| platform             | TEXT        | (nullable — e.g., 'facebook', 'instagram', 'twitter', 'email')                             |
| status               | TEXT        | NOT NULL DEFAULT 'draft', CHECK (status IN ('draft', 'reviewed', 'approved', 'published')) |
| created_at           | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                                     |
| updated_at           | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                                     |



---

### Table 19: `pitch_decks`

**Purpose:** 10-slide pitch deck outlines stored as structured JSON.

| Column      | Type        | Constraints                                                                    |
| ----------- | ----------- | ------------------------------------------------------------------------------ |
| id          | UUID        | PK, DEFAULT gen_random_uuid()                                                  |
| business_id | UUID        | NOT NULL, REFERENCES businesses(id) ON DELETE RESTRICT                         |
| title       | TEXT        | NOT NULL                                                                       |
| slides      | JSONB       | NOT NULL (array of slide objects)                                              |
| status      | TEXT        | NOT NULL DEFAULT 'draft', CHECK (status IN ('draft', 'reviewed', 'finalized')) |
| created_at  | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                         |
| updated_at  | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                         |

**Slide JSONB structure:**

```json
[
  {
    "slide_number": 1,
    "heading": "Problem",
    "bullet_points": ["..."],
    "speaker_notes": "..."
  }
]
```

---

### Table 20: `agent_runs`

**Purpose:** Top-level agent execution record. One per user goal.

| Column       | Type        | Constraints                                                                                                                                 |
| ------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | UUID        | PK, DEFAULT gen_random_uuid()                                                                                                               |
| business_id  | UUID        | NOT NULL, REFERENCES businesses(id) ON DELETE RESTRICT                                                                                      |
| user_id      | UUID        | (nullable, REFERENCES users(id) ON DELETE SET NULL)                                                                                         |
| goal         | TEXT        | NOT NULL                                                                                                                                    |
| status       | TEXT        | NOT NULL DEFAULT 'pending', CHECK (status IN ('pending', 'planning', 'executing', 'awaiting_approval', 'completed', 'failed', 'cancelled')) |
| plan         | JSONB       | (nullable — execution plan from coordinator)                                                                                                |
| final_report | JSONB       | (nullable — final assembled report)                                                                                                         |
| started_at   | TIMESTAMPTZ | (nullable)                                                                                                                                  |
| completed_at | TIMESTAMPTZ | (nullable)                                                                                                                                  |
| created_at   | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                                                                                      |
| updated_at   | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                                                                                      |

**Indexes:** on `(business_id, status)`, on `(user_id)`.

---

### Table 21: `agent_run_steps`

**Purpose:** Individual steps within an agent run. Each step is one agent's execution.

| Column       | Type        | Constraints                                                                                                     |
| ------------ | ----------- | --------------------------------------------------------------------------------------------------------------- |
| id           | UUID        | PK, DEFAULT gen_random_uuid()                                                                                   |
| agent_run_id | UUID        | NOT NULL, REFERENCES agent_runs(id) ON DELETE CASCADE                                                           |
| agent_type   | TEXT        | NOT NULL, CHECK (agent_type IN ('coordinator', 'financial', 'inventory', 'task_allocation', 'marketing', 'qa')) |
| step_number  | INTEGER     | NOT NULL                                                                                                        |
| status       | TEXT        | NOT NULL DEFAULT 'pending', CHECK (status IN ('pending', 'executing', 'completed', 'failed', 'skipped'))        |
| input        | JSONB       | (nullable)                                                                                                      |
| output       | JSONB       | (nullable)                                                                                                      |
| evidence     | JSONB       | (nullable — record IDs, calculation results, verification data)                                                 |
| error        | TEXT        | (nullable)                                                                                                      |
| started_at   | TIMESTAMPTZ | (nullable)                                                                                                      |
| completed_at | TIMESTAMPTZ | (nullable)                                                                                                      |
| created_at   | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                                                          |
| updated_at   | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                                                          |

**Constraints:** UNIQUE(agent_run_id, step_number).

**Indexes:** on `(agent_run_id, step_number)`.

---

### Table 22: `approval_requests`

**Purpose:** Approval gates for consequential agent actions.

| Column            | Type        | Constraints                                                                                         |
| ----------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| id                | UUID        | PK, DEFAULT gen_random_uuid()                                                                       |
| agent_run_id      | UUID        | NOT NULL, REFERENCES agent_runs(id) ON DELETE CASCADE                                               |
| agent_run_step_id | UUID        | NOT NULL, REFERENCES agent_run_steps(id) ON DELETE CASCADE                                          |
| action_type       | TEXT        | NOT NULL (e.g., 'send_payment_reminder', 'create_purchase_order', 'create_task', 'publish_content') |
| action_payload    | JSONB       | NOT NULL                                                                                            |
| status            | TEXT        | NOT NULL DEFAULT 'pending', CHECK (status IN ('pending', 'approved', 'rejected', 'expired'))        |
| requested_by      | TEXT        | NOT NULL (agent_type)                                                                               |
| reviewed_by       | UUID        | (nullable, REFERENCES users(id) ON DELETE SET NULL)                                                 |
| reviewed_at       | TIMESTAMPTZ | (nullable)                                                                                          |
| review_notes      | TEXT        |                                                                                                     |
| created_at        | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                                              |
| updated_at        | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                                              |


**Indexes:** on `(agent_run_id, status)`, on `(status)` for pending-approval queries.

---

### Table 23: `audit_logs`

**Purpose:** Immutable audit trail of all significant actions.

| Column      | Type        | Constraints                                                                                                    |
| ----------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| id          | BIGSERIAL   | PK (sequential, for ordering)                                                                                  |
| business_id | UUID        | (nullable, REFERENCES businesses(id) ON DELETE SET NULL)                                                       |
| user_id     | UUID        | (nullable, REFERENCES users(id) ON DELETE SET NULL)                                                            |
| action      | TEXT        | NOT NULL (e.g., 'invoice.created', 'payment.recorded', 'stock.adjusted', 'task.assigned', 'agent_run.started') |
| entity_type | TEXT        | NOT NULL                                                                                                       |
| entity_id   | UUID        | (nullable)                                                                                                     |
| changes     | JSONB       | (nullable — before/after or full record)                                                                       |
| created_at  | TIMESTAMPTZ | NOT NULL DEFAULT now()                                                                                         |

**Append-only:** Same trigger-based protection as stock_movements — no UPDATE or DELETE.

**Indexes:** on `(business_id, created_at)`, on `(entity_type, entity_id)`.

---

## Task 3: Migrations & Configuration

### Migration tool: custom SQL-file runner (simple, no extra dependency)

A small `migrate.js` script that:

1. Creates a `schema_migrations` table if it does not exist.
2. Reads all `.sql` files in `backend/src/db/migrations/` sorted by filename.
3. Applies any that have not been applied yet, in order.
4. Records each migration name + timestamp in `schema_migrations`.

This avoids the learning curve of `node-pg-migrate` while providing the same core capability. Total code: ~50 lines.

### Database connection configuration

```javascript
// backend/src/db/pool.js
import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || "busyness",
  user: process.env.DB_USER || "busyness",
  password: process.env.DB_PASSWORD || "",
  max: 10,
  idleTimeoutMillis: 30000,
});

export async function query(text, params) {
  return pool.query(text, params);
}
```

### Required additions to `.env.example`

```env
# --- Database ---
DATABASE_URL=postgresql://busyness:busyness@localhost:5432/busyness
DB_HOST=localhost
DB_PORT=5432
DB_NAME=busyness
DB_USER=busyness
DB_PASSWORD=busyness
```

### Migration files

```
backend/src/db/migrations/
├── 001_create_users_businesses.sql
├── 002_create_financials.sql       (customers, invoices, invoice_items, payments)
├── 003_create_inventory.sql        (suppliers, products, stock_movements)
├── 004_create_tasks.sql             (employees, skills, employee_skills, tasks, task_assignments)
├── 005_create_marketing.sql         (marketing_projects, customer_personas, marketing_drafts, pitch_decks)
├── 006_create_agent_infra.sql       (agent_runs, agent_run_steps, approval_requests, audit_logs)
├── 007_create_triggers.sql           (updated_at, append-only for stock_movements and audit_logs)
└── 008_seed_data.sql                 (demo data for the demonstration scenario)
```

### Seed data approach

A `008_seed_data.sql` file inserts:

- 1 demo business ("Demo Trading Sdn Bhd", currency MYR)
- 1 demo user (owner)
- 5 customers
- 10 invoices (mix of draft, unpaid, partially_paid, paid, overdue)
- Invoice items for each invoice
- 8 payments (partial and full)
- 5 suppliers
- 15 products (some low-stock, some near-expiry)
- 30 stock movements (history)
- 8 employees with skills
- 10 existing tasks with assignments
- 2 marketing projects with personas and drafts
- 1 pitch deck
- 2 agent runs with steps (one completed, one in progress)

### Clean-environment initialization

```bash
# 1. Create database (one-time)
createdb busyness

# 2. Run all migrations (creates tables, triggers, indexes)
npm run db:migrate

# 3. Seed demo data
npm run db:seed

# 4. Verify
npm run db:status   # reports table counts
```

### npm scripts to add

```json
{
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "db:migrate": "node src/db/migrate.js up",
    "db:rollback": "node src/db/migrate.js down",
    "db:seed": "node src/db/seed.js",
    "db:reset": "node src/db/migrate.js down && node src/db/migrate.js up && node src/db/seed.js",
    "db:status": "node src/db/status.js",
    "test": "node --test"
  }
}
```

### Database tests

- **Integration tests** in `backend/test/db/` using Node's built-in `node:test` (no extra dependency).
- Each test connects to a test database, runs migrations, inserts fixtures, and verifies queries.
- Financial tests: insert invoice + items + payments, verify outstanding balance query returns correct value.
- Stock consistency tests: insert movements, verify product stock_quantity matches movement sum.
- Constraint tests: attempt invalid inserts (negative amount, duplicate invoice number), verify they fail.

---

## Task 4: Implementation Plan

### Proposed backend folder structure

```
backend/
├── package.json
├── src/
│   ├── index.js                   (existing — will add DB pool import + route mounting)
│   ├── db/
│   │   ├── pool.js                (pg Pool singleton)
│   │   ├── migrate.js             (migration runner script)
│   │   ├── seed.js                (seed data script)
│   │   ├── status.js              (table count reporter)
│   │   └── migrations/
│   │       ├── 001_create_users_businesses.sql
│   │       ├── 002_create_financials.sql
│   │       ├── 003_create_inventory.sql
│   │       ├── 004_create_tasks.sql
│   │       ├── 005_create_marketing.sql
│   │       ├── 006_create_agent_infra.sql
│   │       ├── 007_create_triggers.sql
│   │       └── 008_seed_data.sql
│   ├── routes/
│   │   ├── health.js              (extract /api/health from index.js)
│   │   └── (future: invoices.js, inventory.js, tasks.js, etc.)
│   ├── middleware/
│   │   └── (future: auth.js, error.js)
│   ├── services/
│   │   └── (future: financialService.js, inventoryService.js, etc.)
│   └── utils/
│       └── (future: errors.js, validators.js)
├── test/
│   └── db/
│       ├── financials.test.js
│       ├── inventory.test.js
│       └── constraints.test.js
└── .env.example
```

### Required dependencies

| Package              | Purpose           | Dev? |
| -------------------- | ----------------- | ---- |
| `pg`                 | PostgreSQL client | No   |
| (existing) `express` | Web framework     | No   |

No other dependencies needed for this step. The migration runner and test framework use Node's built-in modules.

### Step-by-step implementation plan

#### Step 3.1: Add dependency and DB config

- Install `pg` in the backend.
- Create `backend/src/db/pool.js`.
- Update `.env.example` with database variables.
- **Acceptance:** `pool.js` exports a working `pool` object; server still starts and `/api/health` still returns 200.

#### Step 3.2: Create migration runner

- Create `backend/src/db/migrate.js` — reads `migrations/*.sql` in order, tracks applied migrations in a `schema_migrations` table, applies unapplied ones.
- Add npm scripts: `db:migrate`, `db:rollback`, `db:seed`, `db:reset`, `db:status`.
- **Acceptance:** `npm run db:migrate` runs without errors on an empty database.

#### Step 3.3: Create schema migrations (001-006)

- Write SQL for all 23 tables, constraints, indexes.
- **Acceptance:** `npm run db:migrate` creates all tables. `npm run db:status` reports 23 tables with 0 rows.

#### Step 3.4: Create trigger migration (007)

- `updated_at` trigger on all mutable tables.
- Append-only triggers on `stock_movements` and `audit_logs`.
- **Acceptance:** Updating a row changes `updated_at`. Attempting to UPDATE/DELETE a `stock_movements` row raises an error.

#### Step 3.5: Create seed data (008)

- Write `008_seed_data.sql` with the demo dataset.
- **Acceptance:** `npm run db:seed` inserts all demo data. Outstanding balance query returns correct values for seeded invoices.

#### Step 3.6: Write database tests

- Create `backend/test/db/` with integration tests using `node:test`.
- Test financial calculations, stock consistency, constraint enforcement.
- **Acceptance:** `npm test` runs all tests and they pass.

#### Step 3.7: Extract health route and add DB health check

- Move `/api/health` to `backend/src/routes/health.js`.
- Add `GET /api/health/db` that runs `SELECT 1` via the pool and reports DB connectivity.
- Update `index.js` to mount routes.
- **Acceptance:** `GET /api/health` still returns 200. `GET /api/health/db` returns DB status when connected.

### Acceptance criteria summary

| Criterion                                                  | How to verify                                     |
| ---------------------------------------------------------- | ------------------------------------------------- |
| All 23 tables created with correct columns and constraints | `\d <table>` in psql                              |
| Money columns are NUMERIC                                  | `\d invoices` shows NUMERIC(12,2)                 |
| Invoice status CHECK constraint works                      | INSERT with invalid status fails                  |
| Outstanding balance calculates correctly                   | Seed data + query returns expected values         |
| Stock quantity matches movement history                    | Seed data + query: product stock = SUM(movements) |
| Append-only tables reject UPDATE/DELETE                    | Manual test or integration test                   |
| Seed data is realistic and covers the demo scenario        | `npm run db:status` + manual inspection           |
| Server still starts and health endpoint works              | `npm start` + `curl localhost:3001/api/health`    |
| DB health endpoint works                                   | `curl localhost:3001/api/health/db`               |
| All tests pass                                             | `npm test`                                        |

---

## Important relationships & delete behavior summary

| Parent -> Child                     | FK behavior        | Rationale                                     |
| ----------------------------------- | ------------------ | --------------------------------------------- |
| businesses -> invoices              | ON DELETE RESTRICT | Cannot delete a business with invoices        |
| businesses -> customers             | ON DELETE RESTRICT | Cannot delete a business with customers       |
| invoices -> invoice_items           | ON DELETE CASCADE  | Items are part of the invoice                 |
| invoices -> payments                | ON DELETE RESTRICT | Cannot delete an invoice that has been paid   |
| businesses -> products              | ON DELETE RESTRICT | Cannot delete a business with inventory       |
| products -> stock_movements         | ON DELETE RESTRICT | Cannot delete a product with movement history |
| suppliers -> products (supplier_id) | ON DELETE SET NULL | Products survive supplier deletion            |
| businesses -> employees             | ON DELETE RESTRICT | Cannot delete a business with employees       |
| employees -> employee_skills        | ON DELETE CASCADE  | Skills are part of the employee profile       |
| tasks -> task_assignments           | ON DELETE CASCADE  | Assignments are part of the task              |
| agent_runs -> agent_run_steps       | ON DELETE CASCADE  | Steps are part of the run                     |
| agent_runs -> approval_requests     | ON DELETE CASCADE  | Approvals are part of the run                 |
| agent_runs -> tasks (agent_run_id)  | ON DELETE SET NULL | Tasks survive agent run deletion              |
| users -> audit_logs (user_id)       | ON DELETE SET NULL | Audit log survives user deletion              |

---

## What this design intentionally does NOT include yet

- Authentication middleware (JWT, session) — deferred to a later step.
- API route handlers for CRUD operations — this step is DB-only.
- Agent orchestration code — Phase 2.
- WorkBuddy runtime integration — Phase 2, requires investigation.
- Expenses table (mentioned in architecture doc) — can be added later; invoices + payments cover the core financial flow for MVP.
- Row-level security policies — business_id filtering in queries is sufficient for the hackathon.

---

**Implementation proceeding step-by-step (3.1 through 3.7) with verification at each stage.**

---

## Design Verification - Review Findings

### 1. Authorization

**Finding:** The schema correctly places `business_id` on every business-scoped table, preventing cross-business data leakage at the FK level. However, the design did not explain how API-level authorization works before JWT authentication is implemented.

**Fix:** Until auth middleware is built, API routes accept an `X-Business-Id` header. Every query includes `WHERE business_id = $1` using that value. Once JWT auth is added, `business_id` is extracted from the JWT claim instead. A middleware function `requireBusinessId` will validate and attach `req.businessId` to every request. No business-scoped query may omit this filter.

**No schema changes needed.** This is a backend service-layer convention enforced in code.

### 2. Financial Integrity

**Finding:** Four gaps identified:

**a) Rounding:** `NUMERIC(12,2)` stores 2 decimal places, but intermediate calculations (`quantity * unit_price * tax_rate / 100`) can produce more. Without explicit rounding, stored values may be truncated inconsistently.

**Fix:** Backend rounds all monetary values to 2 decimal places using `ROUND(amount, 2)` in SQL or explicit rounding before insert. Documented as a service-layer rule.

**b) Payment validation:** The design has `CHECK (amount > 0)` but does not prevent overpayments (payment exceeding outstanding balance).

**Fix:** Payment recording is a single backend transaction:
1. `BEGIN`
2. `SELECT total FROM invoices WHERE id = $1 FOR UPDATE` (lock the invoice row)
3. `SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = $1` (calculate outstanding)
4. Validate: `new_payment_amount <= outstanding` (reject overpayment in MVP)
5. `INSERT INTO payments ...`
6. Update `invoices.status` based on new outstanding (partially_paid, paid, or unchanged)
7. `COMMIT`

**c) Idempotency for payments:** Duplicate API requests could create duplicate payment records.

**Fix:** Add `idempotency_key TEXT` column to `payments` with a `UNIQUE(business_id, idempotency_key)` constraint. The API client sends a unique key per payment request; duplicate submissions are rejected by the constraint.

**d) Refunds:** Not addressed.

**Decision:** Deferred to a future phase. MVP rejects refund requests. Can be modeled later as negative payments or a separate `refunds` table.

### 3. Inventory Integrity

**Finding:** The design specifies `CHECK (stock_quantity >= 0)` and append-only `stock_movements`, but does not address concurrency control or direct stock manipulation.

**Fixes:**

**a) Concurrency:** Stock movement insertion is a single backend transaction:
1. `BEGIN`
2. `SELECT stock_quantity FROM products WHERE id = $1 FOR UPDATE` (lock the product row)
3. Validate: `stock_quantity + quantity_change >= 0` (reject if it would go negative)
4. `INSERT INTO stock_movements ...`
5. `UPDATE products SET stock_quantity = stock_quantity + $change WHERE id = $1`
6. `COMMIT`

This serializes concurrent stock changes for the same product. The `SELECT FOR UPDATE` prevents race conditions.

**b) Direct stock manipulation:** The backend service layer never issues `UPDATE products SET stock_quantity = ...` directly. The only way to change stock is through a stock movement. A trigger enforces this: any UPDATE to `products.stock_quantity` that is NOT triggered by a stock movement insert raises an exception.

**c) Negative stock:** Rejected. The transaction-level check (step 3 above) prevents it before the CHECK constraint would fire.

### 4. Migration Reliability

**Finding:** The `db:rollback` (down migration) script adds complexity with little hackathon value. The design also mentions `node-pg-migrate` in the client comparison but then proposes a custom runner.

**Fixes:**

**a) Remove `db:rollback`.** Replace with `db:reset` that drops all tables (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`) and re-runs all migrations + seed. This is simpler and safer for a hackathon.

**b) Clarify the custom runner.** No external migration framework is used. The runner is ~60 lines of code that:
- Creates a `schema_migrations` table (id SERIAL PK, filename TEXT, applied_at TIMESTAMPTZ)
- Reads `migrations/*.sql` sorted by filename
- Wraps each migration in a transaction (BEGIN, execute SQL, INSERT into schema_migrations, COMMIT)
- On failure: ROLLBACK, print error, exit with non-zero code
- Idempotent: skips already-applied migrations

**c) Updated npm scripts:**
```json
{
  "db:migrate": "node src/db/migrate.js",
  "db:seed": "node src/db/seed.js",
  "db:reset": "node src/db/reset.js",
  "db:status": "node src/db/status.js"
}
```

### 5. Agent Reliability

**Finding:** The design defines run/step statuses, error recording, and approval handling, but does not address duplicate-action prevention when a workflow is retried.

**Fixes:**

**a) Retry tracking:** Add `retry_of UUID REFERENCES agent_runs(id) ON DELETE SET NULL` to `agent_runs`. When a failed run is retried, the new run links to the original. The coordinator checks existing created records (tasks, payments) from the original run before re-executing.

**b) Idempotency for agent-created tasks:** Add a partial unique index: `CREATE UNIQUE INDEX tasks_agent_unique ON tasks(business_id, agent_run_id, title) WHERE source = 'agent'`. This prevents the same agent run from creating duplicate tasks with the same title.

**c) Idempotency for payments:** Already addressed in Financial Integrity section 2c above.

### 6. Forward FK Reference (additional finding)

**Finding:** `tasks.agent_run_id` (migration 004) references `agent_runs.id` (migration 006). Since migration 004 runs before 006, the `agent_runs` table does not exist yet.

**Fix:** Omit `agent_run_id` from the initial `tasks` table creation in migration 004. In migration 006, after creating `agent_runs`, add:
```sql
ALTER TABLE tasks ADD COLUMN agent_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL;
CREATE INDEX idx_tasks_agent_run_id ON tasks(agent_run_id);
```

### Summary of Schema Changes

| Change | Table | Migration |
|--------|-------|-----------|
| Add `idempotency_key TEXT` + UNIQUE(business_id, idempotency_key) | `payments` | 002 |
| Add `retry_of UUID REFERENCES agent_runs(id) ON DELETE SET NULL` | `agent_runs` | 006 |
| Move `agent_run_id` column creation from 004 to 006 via ALTER TABLE | `tasks` | 006 |
| Add partial unique index on tasks for agent-created tasks | `tasks` | 006 |
| Add trigger preventing direct UPDATE of `products.stock_quantity` | `products` | 007 |

### Final Approved Migration Plan

```
001_create_users_businesses.sql   - users, businesses, business_memberships
002_create_financials.sql         - customers, invoices, invoice_items, payments (with idempotency_key)
003_create_inventory.sql          - suppliers, products, stock_movements
004_create_tasks.sql              - employees, skills, employee_skills, tasks (WITHOUT agent_run_id), task_assignments
005_create_marketing.sql          - marketing_projects, customer_personas, marketing_drafts, pitch_decks
006_create_agent_infra.sql        - agent_runs (with retry_of), agent_run_steps, approval_requests, audit_logs, ALTER TABLE tasks ADD agent_run_id
007_create_triggers.sql           - updated_at, append-only (stock_movements, audit_logs), stock_quantity protection
008_seed_data.sql                 - demo data for the demonstration scenario
```

### Acceptance Tests for Implementation

| Test | How to verify | Applies to step |
|------|---------------|-----------------|
| Server starts with `pg` imported | `npm start` succeeds, no crash | 3.1 |
| Health endpoint returns 200 | `curl localhost:3001/api/health` | 3.1 |
| Pool object exports correctly | `node -e "import('./src/db/pool.js').then(m => console.log(typeof m.pool))"` prints `object` | 3.1 |
| Pool closes on shutdown | Server logs pool close on SIGINT | 3.1 |
| Migration runner creates schema_migrations table | `npm run db:migrate` on empty DB | 3.2 |
| All 23 tables created | `SELECT count(*) FROM information_schema.tables WHERE table_schema='public'` returns 23+ | 3.3 |
| Money columns are NUMERIC(12,2) | `\d invoices` shows NUMERIC | 3.3 |
| CHECK constraints reject invalid data | INSERT with bad status fails | 3.3 |
| updated_at trigger works | UPDATE a row, verify updated_at changed | 3.4 |
| Append-only tables reject UPDATE/DELETE | Attempt fails with error | 3.4 |
| Stock_quantity trigger blocks direct updates | UPDATE products SET stock_quantity=X fails | 3.4 |
| Seed data inserts successfully | `npm run db:seed`, verify counts | 3.5 |
| Outstanding balance correct for seeded invoices | Query returns expected values | 3.5 |
| Stock quantity matches movement sum | `SELECT p.stock_quantity, SUM(sm.quantity_change) FROM products p JOIN stock_movements sm` | 3.5 |
| Financial calculation tests pass | `npm test` | 3.6 |
| Stock consistency tests pass | `npm test` | 3.6 |
| Constraint tests pass | `npm test` | 3.6 |
| Health route extracted to routes/health.js | `GET /api/health` still returns 200 | 3.7 |
| DB health endpoint works | `GET /api/health/db` returns status | 3.7 |
