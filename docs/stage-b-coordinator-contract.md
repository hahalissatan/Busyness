# STAGE B — Coordinator Contract Definition

**Phase:** Coordinator Agent & WorkBuddy Runtime Integration  
**Date:** 2025-01-18  

---

## 1. Coordinator Responsibilities (10 Items)

| # | Responsibility | Detail |
|---|---|---|
| 1 | **Receive goal** | Accept a natural-language goal string from the authenticated user via `POST /api/businesses/:businessId/agent/runs` |
| 2 | **Authenticate & authorize** | Run only within the `authenticateToken` + `requireBusinessAccess` middleware chain — inherits `req.user.userId` and `req.businessId`. Never bypasses auth. |
| 3 | **Create agent_run record** | INSERT into `agent_runs` with status='planning', the user's goal, business_id, user_id, started_at=now() |
| 4 | **Decompose goal into steps** | Pattern-match the goal text against known intent patterns. Each matched intent becomes an `agent_run_step` with agent_type, input (the parsed parameters), step_number. |
| 5 | **Execute steps** | For each step, call the corresponding Busyness service function (direct function call, NOT HTTP — avoids double-auth overhead but still uses the same query functions that enforce business_id scoping). Write output and evidence to the step record. |
| 6 | **Record audit trail** | INSERT into `audit_logs` for each step with action, entity_type, entity_id (if applicable), changes (the input/output summary). |
| 7 | **Handle errors** | If a step fails, record the error in agent_run_steps.error, set step status='failed', set agent_run status='failed'. Include error message but never stack traces. |
| 8 | **Produce final report** | Aggregate step outputs into a final_report JSONB. Set agent_run status='completed', completed_at=now(). |
| 9 | **Return response** | Return `{ agent_run_id, status, steps: [...], final_report }` to the caller. |
| 10 | **Respect read-only boundary** | For the minimal path, the coordinator only executes READ operations. No creates, updates, or deletes. Write operations require approval gates (Stage E). |

---

## 2. HTTP Contract

### Request

```
POST /api/businesses/:businessId/agent/runs
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "goal": "Show me low stock items and overdue tasks"
}
```

### Response (200 OK)

```json
{
  "agent_run_id": "uuid-here",
  "status": "completed",
  "goal": "Show me low stock items and overdue tasks",
  "steps": [
    {
      "id": "step-uuid",
      "agent_type": "inventory",
      "step_number": 1,
      "status": "completed",
      "input": { "intent": "low_stock", "params": {} },
      "output": { "items": [...] },
      "evidence": { "row_count": 3 }
    },
    {
      "id": "step-uuid-2",
      "agent_type": "task_allocation",
      "step_number": 2,
      "status": "completed",
      "input": { "intent": "task_overview", "params": {} },
      "output": { "total_tasks": 12, "overdue": 2 },
      "evidence": { "source": "tasks.overview" }
    }
  ],
  "final_report": {
    "summary": "Found 3 low-stock items and 2 overdue tasks.",
    "details": { ... }
  }
}
```

### Response (400 Bad Request)

```json
{
  "error": "Goal is required",
  "details": { "field": "goal" }
}
```

### Response (200 with fallback)

When no intent matches, the coordinator returns a helpful message — NOT an error:

```json
{
  "agent_run_id": "uuid-here",
  "status": "completed",
  "goal": "tell me a joke",
  "steps": [],
  "final_report": {
    "summary": "I can help with inventory, tasks, financials, and marketing. Try: \"show low stock\", \"task summary\", \"financial overview\", or \"marketing overview\".",
    "capabilities": ["low_stock", "task_overview", "financial_overview", "marketing_overview"]
  }
}
```

---

## 3. Intent Router — Rule-Based Pattern Matching

Since no external LLM is configured, the coordinator uses deterministic pattern matching. This is **not faking** — it executes real database queries and returns real data. When an AI key is later configured, the router can be upgraded to LLM-based parsing.

### Intent Registry

| Intent ID | Agent Type | Trigger Patterns (case-insensitive) | Executes |
|---|---|---|---|
| `low_stock` | inventory | "low stock", "low-stock", "stock alert", "reorder" | `SELECT * FROM products WHERE business_id = $1 AND quantity <= reorder_level` |
| `inventory_summary` | inventory | "inventory summary", "stock summary", "how much stock" | `SELECT count(*), sum(value) FROM products WHERE business_id = $1` |
| `task_overview` | task_allocation | "task summary", "overdue task", "task overview", "what tasks" | `SELECT count(*), count(*) FILTER (WHERE due_date < now()) FROM tasks WHERE business_id = $1` |
| `financial_overview` | financial | "financial summary", "revenue", "invoice summary", "cashflow" | `SELECT count(*), COALESCE(SUM(total), 0) FROM invoices WHERE business_id = $1` |
| `marketing_overview` | marketing | "marketing summary", "marketing overview", "campaign status" | `SELECT count(*) FROM marketing_projects WHERE business_id = $1` |
| `team_workload` | task_allocation | "workload", "team workload", "who is busy", "assignment" | `SELECT tm.name, count(t.id) FROM ... GROUP BY tm.id` |

### Matching Logic

```javascript
function matchIntents(goalText) {
  const lower = goalText.toLowerCase();
  const matched = [];

  for (const intent of INTENT_REGISTRY) {
    if (intent.patterns.some(p => lower.includes(p))) {
      matched.push(intent);
    }
  }

  return matched; // Can be 0, 1, or multiple intents
}
```

A single goal can match multiple intents (e.g., "show low stock and overdue tasks" matches both `low_stock` and `task_overview`). Each match becomes a separate step.

---

## 4. Agent Run Lifecycle (Minimal Path)

```
POST /agent/runs received
        │
        ▼
[1] INSERT agent_runs (status='planning')
        │
        ▼
[2] matchIntents(goal) → 0..N matched intents
        │
        ▼
[3] For each matched intent:
    a. INSERT agent_run_steps (status='pending', input={intent, params})
    b. UPDATE agent_run_steps SET status='executing'
    c. Execute real database query (scoped to business_id)
    d. UPDATE agent_run_steps SET status='completed', output={result}, evidence={meta}
    e. INSERT audit_logs (action, entity_type, changes)
        │
        ▼
[4] Aggregate outputs → final_report
        │
        ▼
[5] UPDATE agent_runs SET status='completed', final_report={...}, completed_at=now()
        │
        ▼
[6] Return { agent_run_id, status, steps, final_report }
```

### Status Transitions

```
agent_runs:    planning → executing → completed
                           └→ failed (on error)

agent_run_steps: pending → executing → completed
                            └→ failed (on error)
```

For the minimal path, there is no `awaiting_approval` state — all operations are read-only.

---

## 5. Security Boundary

| Concern | Rule |
|---|---|
| Authentication | Coordinator endpoint is behind `authenticateToken` + `requireBusinessAccess`. No bypass possible. |
| Business scoping | All SQL queries use `req.businessId` from the middleware — never from request body or user input. |
| SQL injection | All queries use parameterized `$1` placeholders. No string interpolation of user input. |
| Read-only | Minimal path only executes SELECT queries. No INSERT/UPDATE/DELETE on business tables (only on agent infrastructure tables). |
| Goal text | User's goal text is stored as-is in `agent_runs.goal` but NEVER interpolated into SQL. It is only used for pattern matching (`lower.includes(pattern)`). |
| Audit trail | Every step execution writes to `audit_logs` (append-only table). |
| Error messages | Errors are recorded in `agent_run_steps.error` but stack traces are never exposed to the API response. |

---

## 6. What the Coordinator Does NOT Do (Minimal Path)

- Does NOT call an external LLM (no API key configured)
- Does NOT call WorkBuddy MCP tools (not connected)
- Does NOT create, update, or delete business records
- Does NOT create approval requests (read-only path needs none)
- Does NOT implement retry logic (single attempt per step)
- Does NOT implement timeout (queries are fast SELECTs)
- Does NOT implement specialist agents (coordinator directly queries DB)

These will be addressed in Stages D (safe test), E (security/reliability), and future specialist-agent work.

---

## 7. Frontend Integration Contract

The frontend `ModulePage.jsx` will receive an `onAsk` prop that calls:

```javascript
async function handleAgentAsk(question) {
  const res = await api.post(`/api/businesses/${business.id}/agent/runs`, {
    goal: question,
  });
  return res.final_report?.summary || "No response from coordinator.";
}
```

The coordinator's response is displayed in the chat thread. If no intent matches, the helpful fallback message is shown.

---

*End of Stage B — Coordinator Contract Definition*
