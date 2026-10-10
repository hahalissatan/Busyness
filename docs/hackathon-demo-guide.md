# BUSYNESS — Hackathon Demo Guide

> **Roadmap Step 9 — Hackathon Demo Preparation**
> All instructions, prompts, and expected outcomes below were verified on the live system on 2026-10-11.

---

## Table of Contents

1. [Prerequisites & Setup](#1-prerequisites--setup)
2. [Verified Startup Instructions](#2-verified-startup-instructions)
3. [Presentation Sequence](#3-presentation-sequence)
4. [Example Prompts — WorkBuddy Retrieving Live Data](#4-example-prompts--workbuddy-retrieving-live-data)
5. [Dashboard Demonstration](#5-dashboard-demonstration)
6. [Coordinator Agent Demonstration](#6-coordinator-agent-demonstration)
7. [Fallback Plan](#7-fallback-plan)
8. [Mock AI Disclosure & Limitations](#8-mock-ai-disclosure--limitations)

---

## 1. Prerequisites & Setup

### System Requirements

| Component | Requirement |
|-----------|-----------|
| Node.js | v22+ |
| PostgreSQL | v14+ (v17 verified) |
| OS | Windows / macOS / Linux |
| WorkBuddy AI | v5.7.6+ (Electron desktop app) |

### Environment Checklist

- [ ] PostgreSQL running on `127.0.0.1:5432` with database `busyness`
- [ ] Database migrated and seeded (`npm run db:reset` from project root)
- [ ] Backend `.env` configured at `backend/.env`
- [ ] MCP server config present at `~/.workbuddy-ai/mcp.json`
- [ ] WorkBuddy AI desktop app installed

### Demo Credentials

| Field | Value |
|-------|-------|
| Email | `owner@demo.busyness` |
| Password | `Demo1234!` |
| Business | Demo Trading Sdn Bhd |
| Business ID | `11111111-1111-1111-1111-111111111111` |

### MCP Configuration (must exist at `~/.workbuddy-ai/mcp.json`)

```json
{
  "mcpServers": {
    "busyness": {
      "type": "stdio",
      "command": "node",
      "args": ["<PROJECT_ROOT>/mcp-server/server.mjs"],
      "env": {
        "BUSYNESS_API_URL": "http://localhost:3001",
        "BUSYNESS_AUTH_TOKEN": "<JWT token for demo user>",
        "BUSYNESS_BUSINESS_ID": "11111111-1111-1111-1111-111111111111"
      },
      "defer_loading": false
    }
  }
}
```

> The MCP server is a stdio-based child process. WorkBuddy launches it automatically when it starts (or on first tool call, depending on `defer_loading`). No manual server start is needed.

---

## 2. Verified Startup Instructions

### Step-by-step (verified 2026-10-11)

```bash
# 1. Start PostgreSQL (if not already running as a service)
#    On Windows: ensure the postgresql service is running
#    On macOS: brew services start postgresql
#    On Linux: sudo systemctl start postgresql

# 2. Verify database is accessible
psql -U busyness -d busyness -h 127.0.0.1 -c "SELECT 1;"
# Expected output: "1"

# 3. Start the backend (from project root)
cd <PROJECT_ROOT>
npm run dev
# Expected: Backend listening on http://localhost:3001

# 4. In a NEW terminal, start the frontend
cd <PROJECT_ROOT>/frontend
npm run dev
# Expected: Vite dev server at http://localhost:5173

# 5. Verify backend health
curl http://localhost:3001/api/health
# Expected: {"status":"ok","service":"Busyness API"}

# 6. Verify frontend responds
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/
# Expected: 200

# 7. Open WorkBuddy AI desktop app
#    WorkBuddy will auto-discover the busyness MCP server
#    No additional MCP server start is needed — WorkBuddy launches it as a child process

# 8. Open browser to http://localhost:5173
#    Click "Get started" to enter the workspace
#    (No login required — the demo auth context auto-authenticates the demo user)
```

### Verification Commands (run before demo)

```bash
# Run the MCP test suite (10 tests, ~5 seconds)
cd <PROJECT_ROOT>/mcp-server
BUSYNESS_API_URL="http://localhost:3001" \
BUSYNESS_AUTH_TOKEN="<JWT>" \
BUSYNESS_BUSINESS_ID="11111111-1111-1111-1111-111111111111" \
node test-mcp.mjs
# Expected: "=== All 10 tests completed successfully ==="

# Run the backend regression suite (347 tests, ~5 seconds)
cd <PROJECT_ROOT>
npx vitest run
# Expected: "Test Files 7 passed (7)" and "Tests 347 passed (347)"
```

---

## 3. Presentation Sequence

A 10-minute demo flow. Adjust timing as needed.

| Time | Segment | What to Show |
|------|---------|-------------|
| 0:00 – 1:00 | **Introduction** | BUSYNESS overview: SMB operations platform with 4 modules (Inventory, Tasks, Financial, Marketing) + AI integration via WorkBuddy |
| 1:00 – 2:30 | **Dashboard Tour** | Open `http://localhost:5173`, click "Get Started", walk through each module hub: Inventory, Tasks, Financial, Marketing |
| 2:30 – 5:00 | **WorkBuddy + Live Data** | Open WorkBuddy AI. Type example prompts (Section 4). Show live inventory and task data retrieved through the MCP server |
| 5:00 – 7:00 | **Coordinator Agent** | Use the coordinator endpoint to show multi-step reasoning: "show low stock" → inventory agent executes → summary with evidence |
| 7:00 – 8:30 | **Conversational AI** | Use the chat endpoint to show natural language → tool call → response |
| 8:30 – 9:00 | **Security** | Show cross-business access denial (HTTP 403) |
| 9:00 – 10:00 | **Q&A + Limitations** | Discuss mock AI, roadmaps, real LLM integration path |

---

## 4. Example Prompts — WorkBuddy Retrieving Live Data

These prompts were executed and verified on 2026-10-11. All data below is real, live database output.

### Prompt 1: Inventory Summary

**Type in WorkBuddy AI chat:**
```
inventory summary
```

**Expected Response:**
```
[Mock LLM] Inventory: 5 products, total value $2988.50. 3 low-stock, 0 out of stock.
```

**Tool call:** `get_inventory_summary`

**Verified data (from PostgreSQL):**
- Total products: 5
- Total inventory value: $2,988.50
- Low-stock items: 3 (Flour 2kg, Rice 10kg, Canned Tuna 425g)
- Out of stock: 0

---

### Prompt 2: Low Stock Alert

**Type in WorkBuddy AI chat:**
```
show low stock
```

**Expected Response (via coordinator agent):**
```
Found 3 low-stock item(s):
  • Flour 2kg All Purpose (SKU: FLOUR-2K-001) — 5.00 units, reorder at 25.00
  • Rice 10kg Jasmine (SKU: RICE-10K-001) — 10.00 units, reorder at 15.00
  • Canned Tuna 425g (SKU: TUNA-425-001) — 30.00 units, reorder at 30.00
```

**Matched intent:** `low_stock`
**Agent step:** inventory agent executed
**Evidence:** `SELECT products WHERE stock_quantity <= min_stock_threshold` — 3 rows from `inventory.products`

---

### Prompt 3: Task Overview

**Type in WorkBuddy AI chat:**
```
task overview
```

**Expected Response (via coordinator agent):**
```
Tasks: 3 total — 2 pending, 1 in progress, 0 completed, 1 overdue.
```

**Matched intent:** `task_overview`

**Verified data (from PostgreSQL):**
- Total tasks: 3
- Pending: 2
- In progress: 1
- Completed: 0
- Overdue: 1

---

### Prompt 4: Financial Overview

**Type in WorkBuddy AI chat:**
```
financial overview
```

**Expected Response (via MCP tool):**
```json
{
  "total_invoices": 5,
  "draft": 1,
  "unpaid": 1,
  "partially_paid": 1,
  "paid": 1,
  "overdue": 1,
  "total_revenue": 3672.90,
  "collected": 1510.50,
  "outstanding": 1897.40
}
```

---

### Prompt 5: Team Workload

**Type in WorkBuddy AI chat:**
```
team workload
```

**Expected Response (via MCP tool):**
```json
{
  "team": [
    { "name": "Siti Aishah", "role": "manager", "assigned": 1, "active": 1, "overdue": 0 },
    { "name": "Raj Kumar", "role": "staff", "assigned": 1, "active": 0, "overdue": 0 },
    { "name": "Mei Ling", "role": "staff", "assigned": 1, "active": 0, "overdue": 1 }
  ],
  "count": 3
}
```

---

### Prompt 6: Product Search

**Type in WorkBuddy AI chat:**
```
find product rice
```

**Expected Response (via MCP tool):**
```json
{
  "items": [
    {
      "name": "Rice 10kg Jasmine",
      "sku": "RICE-10K-001",
      "description": "Jasmine rice 10kg bag",
      "stock_quantity": 10,
      "min_stock_threshold": 15,
      "unit_cost": 45,
      "expiry_date": "2026-10-15",
      "is_active": true
    }
  ],
  "count": 1
}
```

---

## 5. Dashboard Demonstration

### Walkthrough Route

1. **Landing page** (`/`) — Premium welcome screen with BUSYNESS wordmark, tagline "Turn Busyness into Business", floating module icons. Click "Get started" or press Enter.

2. **Inventory Hub** (`/inventory`) — Module overview with quick stats. Navigate to:
   - `/inventory/products` — Full product list (5 items: Flour, Rice, Canned Tuna, Cooking Oil, Sugar)
   - `/inventory/suppliers` — Supplier directory
   - `/inventory/movements` — Stock movement history

3. **Tasks Hub** (`/tasks`) — Task overview with counts. Navigate to:
   - `/tasks/list` — All tasks (3 items: 2 pending, 1 in progress, 1 overdue)
   - `/tasks/team` — Team members (Siti Aishah, Raj Kumar, Mei Ling)

4. **Financial Hub** (`/financial`) — Financial overview. Navigate to:
   - `/financial/customers` — Customer list (3 customers)
   - `/financial/invoices` — Invoice list (5 invoices across draft/unpaid/partially_paid/paid/overdue)

5. **Marketing Hub** (`/marketing`) — Marketing overview. Navigate to:
   - `/marketing/projects` — Campaign projects (1 active)

### Key Talking Points

- All data shown is live from PostgreSQL — no mock data on the frontend
- The four modules share a unified workspace with sidebar navigation
- Theme toggle (dark/light) available in the top-right corner
- Responsive design — works on mobile and desktop

---

## 6. Coordinator Agent Demonstration

The coordinator agent is a rule-based orchestrator that matches natural language goals to specialized sub-agents, executes them, and returns a structured report with evidence.

### How to Demo

Use `curl` (or Postman) to call the coordinator endpoint:

```bash
# Demo 1: Low stock query (most impressive demo)
curl -s -X POST \
  "http://localhost:3001/api/businesses/11111111-1111-1111-1111-111111111111/agent/runs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"goal":"show low stock"}'
```

**Expected response structure:**
```json
{
  "agent_run_id": "<uuid>",
  "status": "completed",
  "goal": "show low stock",
  "steps": [
    {
      "id": "<uuid>",
      "agent_type": "inventory",
      "step_number": 1,
      "status": "completed",
      "input": { "intent": "low_stock", "label": "Low Stock Alert", "source": "coordinator" },
      "output": {
        "items": [ ... 3 product objects ... ],
        "count": 3
      },
      "evidence": {
        "query": "SELECT products WHERE stock_quantity <= min_stock_threshold",
        "row_count": 3,
        "source": "inventory.products"
      }
    }
  ],
  "final_report": {
    "summary": "Found 3 low-stock item(s):\n  • Flour 2kg All Purpose (SKU: FLOUR-2K-001) — 5.00 units, reorder at 25.00\n  • Rice 10kg Jasmine (SKU: RICE-10K-001) — 10.00 units, reorder at 15.00\n  • Canned Tuna 425g (SKU: TUNA-425-001) — 30.00 units, reorder at 30.00",
    "matched_intents": ["low_stock"],
    "capabilities": [ ... full capability list ... ]
  }
}
```

### Demo 2: Task overview

```bash
curl -s -X POST \
  "http://localhost:3001/api/businesses/11111111-1111-1111-1111-111111111111/agent/runs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"goal":"task overview"}'
```

**Expected `final_report.summary`:** `"Tasks: 3 total — 2 pending, 1 in progress, 0 completed, 1 overdue."`

### What to Highlight

- **Intent matching**: The coordinator parses natural language and matches to known intents (pattern-based, not LLM)
- **Multi-agent dispatch**: Each matched intent dispatches to a specialized sub-agent (inventory, tasks, financial, etc.)
- **Evidence trail**: Every step includes evidence (query, row count, source table) — fully auditable
- **Structured report**: `final_report` is an object with `summary` (human-readable text), `matched_intents`, and `capabilities`

### Conversational AI Chat Endpoint

```bash
curl -s -X POST \
  "http://localhost:3001/api/businesses/11111111-1111-1111-1111-111111111111/agent/chat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"message":"inventory summary"}'
```

**Expected response:**
```json
{
  "provider": "mock",
  "reply": "[Mock LLM] Inventory: 5 products, total value $2988.50. 3 low-stock, 0 out of stock.",
  "tool_calls": [{ "tool": "get_inventory_summary", "args": {} }]
}
```

---

## 7. Fallback Plan

### If the MCP Server Becomes Unavailable

WorkBuddy will show an error when trying to invoke busyness tools. In this case:

1. **Switch to direct API calls** — Use `curl` to call the backend tool endpoints directly:
   ```bash
   # List available tools
   curl -s "http://localhost:3001/api/businesses/11111111-1111-1111-1111-111111111111/agent/tools" \
     -H "Authorization: Bearer <JWT>"

   # Execute a tool
   curl -s -X POST \
     "http://localhost:3001/api/businesses/11111111-1111-1111-1111-111111111111/agent/tools/get_inventory_summary" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <JWT>" \
     -d '{}'
   ```

2. **Use the coordinator agent** — Call `POST /agent/runs` directly (no MCP needed):
   ```bash
   curl -s -X POST \
     "http://localhost:3001/api/businesses/11111111-1111-1111-1111-111111111111/agent/runs" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <JWT>" \
     -d '{"goal":"show low stock"}'
   ```

3. **Run the MCP test suite** to diagnose:
   ```bash
   cd mcp-server && BUSYNESS_API_URL="http://localhost:3001" \
     BUSYNESS_AUTH_TOKEN="<JWT>" \
     BUSYNESS_BUSINESS_ID="11111111-1111-1111-1111-111111111111" \
     node test-mcp.mjs
   ```

### If the Backend Becomes Unavailable

1. **Check health**: `curl http://localhost:3001/api/health`
2. **Restart**: `cd <PROJECT_ROOT> && npm run dev`
3. **Check PostgreSQL**: `psql -U busyness -d busyness -h 127.0.0.1 -c "SELECT 1;"`
4. If PostgreSQL is down, start it, then re-run migrations: `npm run db:reset`

### If the Frontend Becomes Unavailable

1. **Restart Vite**: `cd frontend && npm run dev`
2. **Fallback**: Use `curl` to demonstrate API endpoints directly
3. The frontend is not required for the AI/WorkBuddy portion of the demo

### If WorkBuddy AI Desktop App Becomes Unavailable

1. **Use the MCP test client** to demonstrate tool discovery and execution:
   ```bash
   cd mcp-server && node test-mcp.mjs
   ```
2. **Use direct API calls** via curl for all demonstrations
3. The conversational AI and coordinator agent endpoints work independently of WorkBuddy

---

## 8. Mock AI Disclosure & Limitations

### Mock AI Behavior

The current system uses a **mock LLM provider** — not a live LLM (OpenAI, Anthropic, etc.). This is fully disclosed:

- **Provider field**: API responses include `"provider": "mock"`
- **Reply prefix**: All mock LLM responses are prefixed with `[Mock LLM]`
- **`isLive` field**: Set to `undefined` (falsy), clearly indicating no live AI
- **Pattern-based**: The mock LLM matches user messages against known patterns (e.g., "inventory summary" → calls `get_inventory_summary` tool → formats result)
- **No API keys required**: No `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is configured

### What Is Real (Not Mocked)

- ✅ All database queries are real — live PostgreSQL data
- ✅ The MCP server is a real stdio MCP server using the official SDK
- ✅ Tool discovery, execution, and results are real
- ✅ The coordinator agent's intent matching, sub-agent dispatch, and evidence trail are real
- ✅ Cross-business isolation (HTTP 403) is real security enforcement
- ✅ JWT authentication is real
- ✅ The 8 read-only tools execute real database queries

### What Is Mocked

- ❌ The LLM "understanding" of natural language — it's pattern-based, not neural
- ❌ The conversational reply generation — it's template-based, not generative
- ❌ No real AI model is called — no external API calls to OpenAI/Anthropic

### How to Upgrade to Live AI

The architecture is designed for a seamless upgrade path:

1. Set `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`) in `backend/.env`
2. The `llmProvider.js` service already has a `liveLLM` implementation that switches automatically when an API key is present
3. The mock provider remains as a fallback when no key is configured
4. All tool definitions and execution logic remain identical — only the language understanding layer changes

### Known Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| Mock LLM understands only exact phrases | Conversational AI won't respond to free-form questions | Use the exact phrases listed in Section 4 |
| Coordinator requires recognized intent phrases | "which products are low on stock" won't match; use "show low stock" | Use the phrases listed in Section 6 |
| All tools are read-only | Cannot demonstrate write operations (create/update/delete) | By design — security-first approach |
| Single demo business | Only Demo Trading Sdn Bhd has seeded data | Sufficient for hackathon demo |
| JWT token expiry (7 days) | Token in MCP config may expire | Regenerate before demo if needed |
| Auth rate limiting (10 attempts / 15 min) | Repeated login attempts will be throttled | Use direct JWT generation for API testing |

### Setup Requirements Summary

- PostgreSQL 14+ with database `busyness` (migrated + seeded)
- Node.js 22+
- Backend running on port 3001
- Frontend running on port 5173
- WorkBuddy AI desktop app with MCP config at `~/.workbuddy-ai/mcp.json`
- No external API keys required (mock AI works out of the box)

---

*Document verified on 2026-10-11. All commands, prompts, and expected outcomes were executed and confirmed against the live system.*
