# STAGE A — Architecture & Integration Audit Report

**Phase:** Coordinator Agent & WorkBuddy Runtime Integration  
**Date:** 2025-01-18  
**Auditor:** Automated codebase inspection  
**Verdict:** No coordinator-to-WorkBuddy execution path exists. All agent infrastructure tables are unused. The frontend chat is a local demo echo. No AI SDK or API credentials are configured.

---

## 1. Existing Coordinator Agent Implementation

**Finding: NONE EXISTS.**

| Location Checked | Result |
|---|---|
| `backend/src/services/` | 1 file: `marketingGen.js` (deterministic demo content). No `coordinator.js`, no `agentService.js`, no `workbuddyService.js`. |
| `backend/src/routes/` | 6 route files: `auth.js`, `business.js`, `financials.js`, `inventory.js`, `tasks.js`, `marketing.js`. No `agent.js` route. |
| `backend/src/app.js` | Mounts 6 route groups. No agent route is mounted. No coordinator service is imported. |
| `backend/src/middleware/` | 6 middleware files: `auth.js`, `businessAuth.js`, `cors.js`, `rateLimit.js`, `requestLogger.js`, `security.js`. No agent or AI-related middleware. |
| `backend/src/utils/` | 4 utility files: `asyncHandler.js`, `errors.js`, `jwt.js`, `password.js`. No AI or agent utilities. |
| `frontend/src/` | Grep for `coordinator|workbuddy|openai|anthropic|llm` matches only: `ModulePage.jsx` ("demo agent" comment) and `FinancialHub.jsx` (comment about "agent"). No coordinator client. |
| Glob for `*agent*` across project | Only `backend/src/db/migrations/006_create_agent_infra.sql` — the DDL file. No JS code references agent logic. |

**Conclusion:** The Coordinator Agent described in `docs/architecture.md` (the 5-agent design with Coordinator, Financial, Inventory, Task Allocation, Marketing, and QA agents) is **entirely unimplemented**. The architecture document is a planning artifact, not a description of running code.

---

## 2. WorkBuddy Integration Mechanism

**Finding: NONE EXISTS in the Busyness runtime.**

WorkBuddy exists as a **development tool** on this machine at `C:\Users\eddie\.workbuddy-ai\`, but it is **not integrated** into the Busyness backend in any way.

### 2a. What WorkBuddy Has (as a dev tool)

| Path | Contents |
|---|---|
| `~/.workbuddy-ai/mcp-tool-list.json` | MCP tool registry. Contains Miora multimodal tools: canvas operations, text-to-image, image edit, video generation, plus Excel tools. **No business API tools** for Busyness operations (no financial, inventory, task, or marketing endpoints). |
| `~/.workbuddy-ai/connectors/enterprise-registry.json` | Empty: `{"version":1,"enterpriseId":"","fetchedAt":1791377882725,"entries":[]}`. No enterprise connectors configured. |
| `~/.workbuddy-ai/` (directory) | SQLite database, session files, plugin cache — all local dev-tool artifacts. |

### 2b. What the Busyness Backend Has

| Check | Result |
|---|---|
| `backend/package.json` dependencies | `bcryptjs`, `cors`, `dotenv`, `express`, `express-rate-limit`, `helmet`, `jsonwebtoken`, `pg`, `zod`. **No AI SDK** (no `openai`, `@anthropic-ai/sdk`, `langchain`, `@microsoft/mcp`, etc.). |
| `backend/.env` | `PORT`, `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, rate limit configs. **No `OPENAI_API_KEY`, `AI_API_KEY`, or WorkBuddy runtime config.** |
| `backend/src/` codebase | **Zero imports** of WorkBuddy SDK, MCP client, or AI provider SDK. No HTTP client configured to call WorkBuddy. |
| `frontend/package.json` | `react`, `react-dom`, `react-router-dom`. No AI dependencies. |

**Conclusion:** WorkBuddy is a standalone development assistant installed on the developer's machine. There is no runtime bridge between the Busyness Express backend and WorkBuddy's MCP tool registry. The two systems are completely separate.

---

## 3. How User Messages Travel from Frontend Through Backend

**Finding: The frontend chat is a local demo echo. No backend endpoint is called.**

### 3a. The Message Flow (Current)

```
User types in chat input (ModulePage.jsx)
        │
        ▼
handleAsk(question)
        │
        ├── If onAsk prop exists:
        │     calls onAsk(question)
        │     If result !== undefined, adds to thread
        │     (Currently NO module passes onAsk — all use fallback)
        │
        └── Fallback (always taken):
              Adds user message to thread
              Adds hardcoded echo: "I'm a demo agent. Connect a backend
                  handler via the `onAsk` prop to enable real responses."
              Returns — NO fetch(), NO api.post(), NO backend call
```

### 3b. Key Code Evidence

`frontend/src/components/ModulePage.jsx`:
```javascript
const handleAsk = async (question) => {
  if (onAsk) {
    const result = await onAsk(question);
    if (result !== undefined) { /* add to thread */ return; }
  }
  // Default fallback echo — NO backend call
  setThread((t) => [...t, { role: "user", text: question },
    { role: "assistant", text: "I'm a demo agent. Connect a backend handler via the `onAsk` prop to enable real responses." }]);
};
```

**No module page** (`FinancialHub.jsx`, `InventoryHub.jsx`, `TasksHub.jsx`, `MarketingHub.jsx`) passes an `onAsk` prop to `ModulePage`. All four modules rely on the fallback echo.

### 3c. What the API Client Could Do (But Doesn't for Chat)

`frontend/src/api/client.js` is a well-structured fetch wrapper:
- Attaches Bearer token from localStorage
- Handles 401 by redirecting to `/`
- Supports GET, POST, PATCH, PUT, DELETE
- Normalizes pagination from `{data, pagination}` or `{data, count}` shapes

The client is fully functional and used for all CRUD operations (financials, inventory, tasks, marketing). It simply has **no chat endpoint to call**.

---

## 4. Whether the Coordinator Actually Invokes WorkBuddy

**Finding: NO. The coordinator does not exist, and no code invokes WorkBuddy.**

| Question | Answer |
|---|---|
| Is there a coordinator service? | No. |
| Does any code import or call WorkBuddy SDK? | No. |
| Does any code call an MCP tool? | No. |
| Does any code call an LLM API? | No — `marketingGen.js` checks for `OPENAI_API_KEY` / `AI_API_KEY` env vars but falls back to deterministic demo content because neither key is set. |
| Does any code write to agent_runs / agent_run_steps? | No. |
| Does any code write to approval_requests? | No. |
| Does any code write to audit_logs? | No. |

---

## 5. Available Tools and Permission Boundaries

**Finding: No tools are registered, exposed, or permissioned.**

### 5a. WorkBuddy's MCP Tools (Not Connected)

The `mcp-tool-list.json` in WorkBuddy contains:
- Canvas operations (create_design, open_design, etc.)
- Image generation (text-to-image, image edit)
- Video generation
- Excel tools (sheetagent operations)

These are **multimedia/document tools** — they have nothing to do with Busyness business operations (financial CRUD, inventory management, task allocation, marketing generation). Even if connected, they would not help with business API operations.

### 5b. Busyness Backend API (Fully Functional, Not Agent-Connected)

The backend has **6 fully functional route groups** with auth + business membership enforcement:

| Route Group | Endpoints | Auth |
|---|---|---|
| `/api/auth` | register, login | Public, rate-limited |
| `/api/businesses/:businessId` | me, members, settings | JWT + business membership |
| `/api/businesses/:businessId/financials` | customers, invoices, payments, overview | JWT + business membership |
| `/api/businesses/:businessId/inventory` | products, suppliers, stock-movements, overview, low-stock | JWT + business membership |
| `/api/businesses/:businessId/tasks` | team-members, tasks, assignments, overview | JWT + business membership |
| `/api/businesses/:businessId/marketing` | projects, personas, drafts, pitch-decks, overview | JWT + business membership |

All business-scoped routes require:
1. `authenticateToken` — verifies JWT from `Authorization: Bearer <token>` header
2. `requireBusinessAccess` — verifies user has active membership in the business (from URL path param, not body/query)

**There is no tool registration, tool permission system, or agent-level access control.** The auth boundary is user-level JWT + business membership. There is no concept of "agent permissions" or "tool allowlists."

---

## 6. Existing Storage for Agent Runs, Approvals, and Audit

**Finding: Database tables exist (migration 006) but are completely unused.**

### 6a. Agent Infrastructure Tables (Created but Empty)

Migration `006_create_agent_infra.sql` created 4 tables:

#### `agent_runs`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| business_id | UUID FK → businesses | |
| user_id | UUID FK → users | |
| goal | TEXT | The user's natural-language request |
| status | TEXT CHECK | pending, planning, executing, awaiting_approval, completed, failed, cancelled |
| plan | JSONB | Coordinator's decomposition plan |
| final_report | JSONB | Final output |
| retry_of | UUID FK → agent_runs (self) | For retry chains |
| started_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |

#### `agent_run_steps`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agent_run_id | UUID FK → agent_runs | |
| agent_type | TEXT CHECK | coordinator, financial, inventory, task_allocation, marketing, qa |
| step_number | INTEGER | |
| status | TEXT CHECK | pending, executing, completed, failed, skipped |
| input | JSONB | |
| output | JSONB | |
| evidence | JSONB | |
| error | TEXT | |

#### `approval_requests`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agent_run_id | UUID FK → agent_runs | |
| agent_run_step_id | UUID FK → agent_run_steps | |
| action_type | TEXT | |
| action_payload | JSONB | |
| status | TEXT CHECK | pending, approved, rejected, expired |
| requested_by | UUID FK → users | |
| reviewed_by | UUID FK → users | |
| reviewed_at | TIMESTAMPTZ | |
| review_notes | TEXT | |

#### `audit_logs`
| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | Append-only, no UPDATE/DELETE grants |
| business_id | UUID FK → businesses | |
| user_id | UUID FK → users | |
| action | TEXT | |
| entity_type | TEXT | |
| entity_id | UUID | |
| changes | JSONB | |
| created_at | TIMESTAMPTZ DEFAULT now() | |

### 6b. Tasks Table Extension

Migration 006 also added:
```sql
ALTER TABLE tasks ADD COLUMN agent_run_id UUID REFERENCES agent_runs(id);
```
And a partial unique index:
```sql
CREATE UNIQUE INDEX ... ON tasks(business_id, agent_run_id, title) WHERE source = 'agent';
```

### 6c. Usage Status

| Table | Rows Written By Code | Rows Read By Code |
|---|---|---|
| `agent_runs` | 0 — no INSERT in any route or service | 0 — no SELECT in any route or service |
| `agent_run_steps` | 0 | 0 |
| `approval_requests` | 0 | 0 |
| `audit_logs` | 0 | 0 |
| `tasks.agent_run_id` | 0 — column exists, never populated; also protected from PATCH updates | 0 — included in SELECT but always NULL |

**Conclusion:** The database schema was designed for agent infrastructure, but no application code reads or writes any of it. The tables are ready for use but completely dormant.

---

## 7. Current Timeout, Retry, Cancellation, and Error-Handling Behavior

**Finding: No agent-level timeout, retry, or cancellation exists.**

### 7a. What Exists

| Concern | Implementation |
|---|---|
| HTTP request timeout | None configured on the Express server or the frontend fetch client. |
| Rate limiting | General rate limiter (configurable window + max) and auth-specific rate limiter. Applies to all HTTP routes. No agent-specific limits. |
| Error handling | Centralized error handler in `app.js` handles: HttpError subclasses, body-parser errors, PostgreSQL errors (23505, 23503, 23514 mapped to safe messages), and unknown errors (500 with no stack trace in production). |
| `agent_runs.retry_of` | Column exists in schema. No code uses it. No retry logic. |
| `agent_runs.status` transitions | Schema allows pending→planning→executing→awaiting_approval→completed/failed/cancelled. No code implements any transition. |
| Cancellation | No mechanism. No endpoint to cancel an agent run. No timeout on long-running operations. |
| Idempotency | The partial unique index on tasks prevents duplicate agent-created tasks. But no other idempotency keys exist. |

### 7b. What the marketingGen.js Pattern Shows

`marketingGen.js` has a provider-detection pattern:
```javascript
const hasKey = (process.env.OPENAI_API_KEY && ...) || (process.env.AI_API_KEY && ...);
```
If a key existed, the comment says it "would call that provider." But:
- No key is configured
- No actual API call code exists (only the deterministic fallback)
- No timeout, retry, or streaming logic
- No error handling for API failures

---

## 8. Missing Dependencies and External Credentials

**Finding: Multiple critical dependencies are missing for real AI execution.**

### 8a. Missing: AI Provider SDK

No AI SDK is installed. To call an LLM (OpenAI, Anthropic, etc.), one of these would need to be installed:
- `openai` (npm package)
- `@anthropic-ai/sdk`
- Or a generic HTTP client call to an LLM endpoint

### 8b. Missing: AI API Credentials

`backend/.env` has no:
- `OPENAI_API_KEY`
- `AI_API_KEY`
- `ANTHROPIC_API_KEY`
- Any other LLM provider credentials

### 8c. Missing: WorkBuddy Runtime Connector

WorkBuddy exists as a dev tool, but there is no:
- HTTP client in the backend configured to call WorkBuddy's local API
- MCP client SDK in the backend
- Environment variable pointing to WorkBuddy's API endpoint
- Bridge service that translates Busyness API operations into MCP tool calls

### 8d. Missing: Agent Route

No `POST /api/businesses/:businessId/agent/runs` or similar endpoint exists. The backend has no entry point for agent operations.

### 8e. Missing: Coordinator Service

No `backend/src/services/coordinator.js` or equivalent. No service that:
- Receives a user goal
- Decomposes it into steps
- Routes steps to specialist agents
- Collects results
- Writes to agent_run_steps
- Creates approval requests for destructive actions
- Produces a final report

### 8f. Missing: Frontend Chat-to-Backend Wiring

No module passes an `onAsk` handler that calls the backend. The `ModulePage.jsx` fallback echo is always triggered.

---

## 9. Architecture Diagram — Current State

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (React)                      │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │Financial │ │Inventory │ │  Tasks   │ │Marketing │ │
│  │   Hub    │ │   Hub    │ │   Hub    │ │   Hub    │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ │
│       │             │             │             │       │
│       └─────────────┴─────────────┴─────────────┘       │
│                         │                               │
│                  ┌──────▼──────┐                        │
│                  │ ModulePage  │                        │
│                  │  handleAsk  │                        │
│                  │  (DEMO ECHO)│  ← No backend call     │
│                  └─────────────┘                        │
│                         │                               │
│                  ┌──────▼──────┐                        │
│                  │ api/client  │  ← Functional, used    │
│                  │   .js       │    for CRUD only       │
│                  └──────┬──────┘                        │
└─────────────────────────┼───────────────────────────────┘
                          │ HTTP (Vite proxy)
┌─────────────────────────┼───────────────────────────────┐
│                    BACKEND (Express)                     │
│                         │                               │
│  ┌──────────────────────▼──────────────────────────┐   │
│  │              app.js (Express factory)             │   │
│  │  Middleware: helmet, cors, logger, rateLimit,    │   │
│  │               json, auth, businessAuth            │   │
│  └──────────────────────┬──────────────────────────┘   │
│                         │                               │
│    ┌────────┬───────────┼───────────┬────────┐         │
│    │        │           │           │        │         │
│  ┌─▼──┐ ┌──▼──┐ ┌──────▼────┐ ┌───▼──┐ ┌──▼────┐    │
│  │auth│ │busin│ │financials │ │invnt │ │tasks  │    │
│  │    │ │ ess │ │           │ │      │ │       │    │
│  └────┘ └─────┘ └───────────┘ └──────┘ └───────┘    │
│                                              ┌──────┐  │
│                                              │mktng │  │
│                                              └──────┘  │
│                                                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │              services/                            │   │
│  │  marketingGen.js (deterministic demo fallback)   │   │
│  │  ← Checks for OPENAI_API_KEY, falls back to demo  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │           NO COORDINATOR SERVICE                  │   │
│  │           NO AGENT ROUTE                          │   │
│  │           NO WORKBUDDY CONNECTOR                   │   │
│  └─────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────┐
│                   DATABASE (PostgreSQL)                  │
│                                                         │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ │
│  │businesses│ │ users    │ │financials│ │ inventory  │ │
│  │memberships│ │ sessions│ │ invoices │ │ products   │ │
│  └─────────┘ └──────────┘ └──────────┘ └────────────┘ │
│  ┌──────────┐ ┌──────────────┐ ┌─────────────┐         │
│  │  tasks   │ │agent_runs    │ │audit_logs   │         │
│  │team_membr│ │agent_steps   │ │             │         │
│  └──────────┘ └──────────────┘ └─────────────┘         │
│                ┌──────────────┐                         │
│                │approval_reqs │                         │
│                └──────────────┘                         │
│                                                         │
│  ✅ Business tables: ACTIVE (fully used)                │
│  ⚠️ Agent tables: DORMANT (created, never read/written) │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              WORKBUDDY (Dev Tool — NOT CONNECTED)        │
│                                                         │
│  ~/.workbuddy-ai/                                       │
│    ├── mcp-tool-list.json  (canvas, image, video, xlsx)│
│    ├── connectors/          (empty enterprise registry)  │
│    ├── sessions/            (local dev sessions)         │
│    └── plugins/             (dev tool plugins)          │
│                                                         │
│  ❌ No bridge to Busyness backend                       │
│  ❌ No business API tools in MCP registry               │
│  ❌ Not referenced by any Busyness code                 │
└─────────────────────────────────────────────────────────┘
```

---

## 10. Exact Blockers for Real Execution

| # | Blocker | Impact | Resolution Path |
|---|---|---|---|
| 1 | No AI SDK installed in backend | Cannot call any LLM | Install `openai` or equivalent, OR implement a local coordinator that routes to existing Busyness API endpoints |
| 2 | No AI API credentials configured | Even with SDK, no LLM can be called | Add `OPENAI_API_KEY` to `.env`, OR design coordinator to work without external LLM |
| 3 | No agent route in Express | No HTTP entry point for agent operations | Create `backend/src/routes/agent.js` with `POST /api/businesses/:businessId/agent/runs` |
| 4 | No coordinator service | No logic to decompose goals, route steps, collect results | Create `backend/src/services/coordinator.js` |
| 5 | No WorkBuddy runtime connector | Cannot invoke WorkBuddy MCP tools from backend | Either: (a) build HTTP bridge to WorkBuddy's local API, (b) use WorkBuddy's MCP client SDK, or (c) bypass WorkBuddy and use existing Busyness API endpoints as "tools" |
| 6 | Frontend chat not wired to backend | User messages never reach the backend | Wire `ModulePage.jsx` `onAsk` to call new agent endpoint |
| 7 | No tool registration or permission system | No concept of what an agent is allowed to do | Define tool allowlist per agent_type in coordinator service |
| 8 | No timeout/retry/cancellation | Agent runs could hang indefinitely | Add timeout on coordinator execution, status transitions in DB |

---

## 11. What Can Be Built Without External AI Credentials

The coordinator can be designed to work **without an external LLM** by using a **rule-based intent router** instead of an LLM for goal decomposition. This approach:

1. **Pattern-matches** the user's natural-language goal against known intent patterns (e.g., "show me low stock" → inventory query, "create invoice" → financial action)
2. **Routes** to the appropriate existing Busyness API endpoint (which already has full CRUD + auth)
3. **Writes** to agent_runs / agent_run_steps for audit trail
4. **Returns** real data from the database

This is **not faking** execution — it is executing real Busyness API operations with real database queries and real auth. The "intelligence" is in the routing logic, not in an LLM. This is the same pattern `marketingGen.js` already uses (deterministic fallback when no AI key is present).

When an AI key is later configured, the router can be upgraded to use LLM-based intent parsing — the interface stays the same.

---

## 12. Summary Assessment

| Area | Status | Detail |
|---|---|---|
| Coordinator Agent | ❌ Does not exist | No code, no route, no service |
| WorkBuddy Integration | ❌ Not connected | Dev tool only, no runtime bridge |
| Frontend Chat | ❌ Demo echo | No backend call, hardcoded response |
| Agent Infrastructure DB | ⚠️ Dormant | Tables exist, completely unused |
| Business API | ✅ Fully functional | All 6 route groups working, auth enforced |
| AI SDK | ❌ Not installed | No openai, anthropic, or MCP SDK |
| AI Credentials | ❌ Not configured | No API keys in .env |
| Agent Route | ❌ Does not exist | No HTTP entry point for agent operations |
| Timeout/Retry/Cancellation | ❌ None | No mechanism exists |

**The system has a fully functional business API and a dormant agent infrastructure schema. The gap between them — the coordinator service, the agent route, the runtime connector, and the frontend wiring — is entirely unimplemented.**

---

*End of Stage A Audit Report*
