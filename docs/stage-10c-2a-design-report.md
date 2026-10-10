# Phase 10C — Conversational AI Upgrade
## Stage 2A: Existing LLM Integration Audit and Conversational AI Implementation Plan

> **Status:** Inspection and planning only. No code, dependencies, configuration, schema, or data has been modified.
> No external model calls were made. No API charges were incurred.
> **Date:** 2026-10-11
> **Prerequisite:** Phase 10C Stage 1 (Inventory Intelligence Design) — completed
> **Goal:** Give BUSYNESS an intelligent, natural, human-like AI chat experience that understands business questions, remembers conversation context, reasons over real business data, and explains insights naturally — without hardcoded keyword templates.

---

## Table of Contents

1. [Verified Current Integration Inventory](#1-verified-current-integration-inventory)
2. [Recommended Provider Strategy and Prerequisites](#2-recommended-provider-strategy-and-prerequisites)
3. [Proposed Backend and Frontend Message Flow](#3-proposed-backend-and-frontend-message-flow)
4. [Tool-Calling and Authorisation Design](#4-tool-calling-and-authorisation-design)
5. [Conversation-Context Strategy](#5-conversation-context-strategy)
6. [Files Expected to Change in Later Implementation](#6-files-expected-to-change-in-later-implementation)
7. [Minimal First Milestone, Follow-Up Phases, Test Matrix, Cost/Privacy/Reliability/Risks](#7-minimal-first-milestone-follow-up-phases-test-matrix-costprivacyreliabilityrisks)

---

## 1. Verified Current Integration Inventory

### 1.1 Executive Summary

**No LLM integration exists anywhere in the BUSYNESS codebase.** There is no LLM SDK in any `package.json`, no LLM API key in any `.env` file, no outbound HTTP call in any backend source file, and no AI model invocation in any service. The application's "AI" capabilities are entirely rule-based: the coordinator uses substring matching to route user questions to predefined SQL queries, and `marketingGen.js` has a provider-detection interface that always falls back to deterministic demo templates because no API key is configured.

This is not a deficiency to work around — it is a **clean foundation** to build upon. There is no legacy LLM code to migrate, no conflicting SDK to remove, and no existing API integration to break. The implementation can start from a blank slate with a deliberate, well-architected conversational AI layer.

### 1.2 Package Dependencies — No LLM SDK

| package.json | AI-related dependencies | Status |
|---|---|---|
| `backend/package.json` | **None.** Deps: bcryptjs, cors, dotenv, express, express-rate-limit, helmet, jsonwebtoken, pg, zod | Clean — no SDK to remove |
| `frontend/package.json` | **None.** Deps: react, react-dom, react-router-dom | Clean |
| `root package.json` | **None.** DevDep: playwright only | Clean |

**Implication:** No `openai`, `anthropic`, `@anthropic-ai/sdk`, `langchain`, `@langchain/core`, `ai` (Vercel AI SDK), `google-ai`, `@google/generative-ai`, or any other LLM client library is installed. Adding one is a fresh dependency decision, not a migration.

**Key technical fact:** Node.js 22.22.2 (the runtime used by the backend) has a **built-in global `fetch()`**. Any LLM provider with a REST API (OpenAI, Anthropic, Google Gemini, DeepSeek, Ollama) can be called directly with `fetch()` — **no SDK installation is required**. This is the recommended approach for minimal dependency surface.

### 1.3 Environment Variables — No LLM Configuration

**`backend/.env` (actual runtime config):**

```env
PORT=3001
NODE_ENV=development
DATABASE_URL=postgresql://postgres.xinihcblswmyhqqzdcba:****@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres
DB_SSL=
JWT_SECRET=****
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:5173
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
RATE_LIMIT_AUTH_WINDOW_MS=900000
RATE_LIMIT_AUTH_MAX=10
```

**AI-related env vars found:** ZERO. No `OPENAI_API_KEY`, no `AI_API_KEY`, no `LLM_MODEL`, no `LLM_BASE_URL`, no `ANTHROPIC_API_KEY`, no `GOOGLE_API_KEY`.

**`backend/.env.example` and root `.env.example`:** Both are identical templates with the same vars as `.env`. No AI-related vars documented. This confirms that `marketingGen.js`'s env-var checks were aspirational interface design — they were never backed by actual configuration.

### 1.4 Outbound HTTP — Zero Calls

A comprehensive search of all `.js` files in `backend/src/` for `fetch(`, `axios`, `http.`, `https.`, `XMLHttpRequest`, `WebSocket`, and `EventSource` returned **ZERO matches**. The backend makes no outbound HTTP calls whatsoever.

**Implication:** The backend is a closed system — it only serves inbound API requests and queries the PostgreSQL database. Adding LLM API calls will be the **first outbound HTTP traffic** the backend ever makes, which means:
- No existing HTTP client to modify (use native `fetch()`)
- No existing rate-limiting or retry logic for external calls (must be built)
- No existing timeout configuration for outbound requests (must be added)
- No existing error handling for external service failures (must be designed)

### 1.5 marketingGen.js — The "AI" Service That Never Calls AI

`backend/src/services/marketingGen.js` (~382 lines) is the only file in the codebase with an AI-provider detection pattern:

```javascript
export function getGeneratorInfo() {
  const hasKey =
    (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 0) ||
    (process.env.AI_API_KEY && process.env.AI_API_KEY.length > 0);
  return {
    provider: hasKey ? "ai" : "demo",
    note: hasKey
      ? "Content generated by AI provider."
      : "Content generated by deterministic demo fallback. No AI model was called...",
  };
}
```

Since neither env var is set, `provider` is always `"demo"`. All five exported functions (`generateMarketingContent`, `generatePersona`, `generatePitchDeck`, `reviseContent`, `getGeneratorInfo`) produce deterministic string templates with `[Demo]` labels. No HTTP call is ever made.

**Reusable pattern:** The `hasKey` detection approach is a sound pattern for a provider-agnostic adapter — check for a configured key, fall back gracefully. The LLM adapter proposed in Section 2 will use a similar pattern but with actual API calls when a key is present.

### 1.6 Coordinator — Rule-Based Intent Router (No LLM)

`backend/src/services/coordinator.js` (~695 lines) is the central agent orchestrator. The file header explicitly states:

> "This is a RULE-BASED coordinator that does NOT call an external LLM."

**How it works:**
1. `matchIntents(goalText)` — lowercases the user's goal, iterates through `ALL_INTENTS` (11 total), and checks `lower.includes(pattern)` for each pattern string.
2. For each matched intent, it creates an `agent_run_step`, calls `intent.execute(businessId, goal)`, and records the output.
3. `formatStepSummary(intent, output)` converts structured query results into a human-readable string.
4. `formatFallbackResponse(goal)` lists all 11 capabilities when no intent matches.

**The 11 existing intents (these are the "tools" an LLM could call):**

| # | Intent ID | Agent Type | Source | Patterns (examples) |
|---|---|---|---|---|
| 1 | `low_stock` | inventory | coordinator | "low stock", "running low", "reorder" |
| 2 | `inventory_summary` | inventory | coordinator | "inventory", "stock summary", "how much stock" |
| 3 | `task_overview` | task_allocation | coordinator | "tasks", "task overview", "what needs doing" |
| 4 | `team_workload` | task_allocation | coordinator | "team workload", "who is busy" |
| 5 | `financial_overview` | financial | coordinator | "finances", "money", "revenue", "profit" |
| 6 | `customer_summary` | financial | coordinator | "customers", "customer summary" |
| 7 | `marketing_overview` | marketing | coordinator | "marketing", "campaigns", "ads" |
| 8 | `product_search` | inventory | inventoryAgent | "find product", "search product", "show product" |
| 9 | `near_expiry` | inventory | inventoryAgent | "expiring", "expiry", "near expiry" |
| 10 | `stock_movement_history` | inventory | inventoryAgent | "stock movement", "movement history" |
| 11 | `inventory_by_supplier` | inventory | inventoryAgent | "by supplier", "supplier inventory" |

Each intent has an `async execute(businessId, goal)` function that runs a parameterized SQL query scoped to `businessId`. All operations are **read-only**.

**This is the critical insight:** The 11 intent `execute` functions are the **business data tools** an LLM needs. Instead of the LLM writing SQL, the LLM selects which tool to call, and the existing `execute` function runs the safe, parameterized, business-scoped query. This is tool-calling without teaching the LLM SQL.

### 1.7 Frontend Chat — Simple Text-In/Text-Out, No Context

**`frontend/src/components/ModulePage.jsx`** (~140 lines) is the shared chat interface used by all four module hub pages (Financial, Inventory, Task Allocation, Marketing).

**Current chat flow:**
```
User types question in ChatInput
    ↓
ModulePage.handleAsk(question)
    ↓
api.post('/api/businesses/${business.id}/agent/runs', { goal: question })
    ↓
Backend: coordinator matches intents → runs SQL → returns { final_report: { summary: string } }
    ↓
Frontend: extracts res.final_report.summary (a single string)
    ↓
Appends { role: 'assistant', text: summary } to thread
```

**Key limitations confirmed by reading the source:**

| Issue | Detail | Impact |
|---|---|---|
| **No conversation context sent** | Request body is `{ goal: question }` — only the current question, no history | LLM cannot understand follow-ups like "what about the supplier?" |
| **In-memory thread only** | `const [thread, setThread] = useState([])` — lost on page refresh | User loses entire conversation on navigation/reload |
| **String-only responses** | Only `final_report.summary` (a plain string) is extracted and displayed | No structured data, no tables, no charts, no rich formatting |
| **No streaming** | Full JSON response awaited before display | User sees "Processing…" spinner with no incremental feedback |
| **No metadata in messages** | Messages are `{ role, text }` only | No tool-call visibility, no confidence, no evidence |
| **All step data discarded** | The response includes `steps`, `matched_intents`, `step_count`, etc. — all ignored | User sees only a summary string, not the reasoning |

**`ChatInput.jsx`** (~357 lines) provides:
- Text input with Enter-to-send
- Voice recognition (Web Speech API — Chrome/Edge only, no audio saved)
- File attachment (client-side only — no backend upload endpoint, files listed by name in message text)

Neither voice nor file features currently interact with any LLM. Voice transcripts become text and go through the same `handleAsk` path. Files are displayed as names but never uploaded or processed.

### 1.8 Agent Infrastructure — Existing Tables Are LLM-Ready

Migration 006 created infrastructure that can record LLM-based agent runs without schema changes:

| Table | Purpose | LLM Reuse Potential |
|---|---|---|
| `agent_runs` | Records each run: business_id, user_id, goal, status, plan (JSONB), final_report (JSONB), retry_of (self-FK) | `plan` JSONB (currently NULL/unused) could store conversation context or LLM tool-call chain |
| `agent_run_steps` | Records each step: agent_type (CHECK constraint), status, input/output/evidence (all JSONB), error | Could record each LLM tool-call as a step. **Constraint:** `agent_type` CHECK only allows `coordinator`, `financial`, `inventory`, `task_allocation`, `marketing`, `qa` — adding `llm` or `conversational` would require ALTER TABLE |
| `audit_logs` | BIGSERIAL, append-only, trigger-protected (no UPDATE/DELETE) | Already records all agent actions — LLM tool-calls can be audited here |
| `approval_requests` | For human-in-the-loop approvals | Could gate dangerous LLM-proposed actions (future, not Phase 1) |

**`agent_runs.retry_of`** (self-referencing FK) could be repurposed to link a follow-up run to its parent conversation turn — but this is a creative reuse, not its intended purpose.

### 1.9 WorkBuddy Investigation — Cannot Be Used as LLM Provider

Per `docs/stage-d-workbuddy-investigation.md` (~177 lines):

- WorkBuddy is an **Electron desktop application** (`WorkBuddyAI.exe`), not a server
- No HTTP API, no CLI binary, no SDK, no MCP server configuration
- Cannot be invoked from the Busyness backend process
- It is a local AI assistant tool for developers, not a hosted model endpoint

**Conclusion:** WorkBuddy cannot serve as the LLM provider for Busyness. A dedicated LLM provider (OpenAI, Anthropic, Google, DeepSeek, or local Ollama) must be chosen separately.

### 1.10 Auth and Security Context

**`backend/src/middleware/auth.js`** — `authenticateToken`: Extracts JWT from `Authorization: Bearer <token>`, verifies with `JWT_SECRET`, attaches `req.user = { userId, email }`.

**`backend/src/middleware/businessAuth.js`** — `requireBusinessAccess`: Verifies the user is a member of the business in the URL path (`/api/businesses/:businessId/...`), attaches `req.businessId`.

**`frontend/src/api/client.js`** — Fetch wrapper. Reads `busyness_token` from `localStorage`, sends as Bearer header. On 401, clears token and redirects to landing page.

**`frontend/src/context/AuthContext.jsx`** — On first visit with no token, auto-registers a demo user. Token, user, and business stored in `localStorage`.

**Security significance for LLM integration:**
- `businessId` comes from the auth context (JWT + business membership check), **never from user input or LLM output** — this is the critical security boundary
- The LLM will never receive `businessId` as a parameter; the backend injects it into every tool call server-side
- This means even if an LLM hallucinates a different business ID, the actual query will always be scoped to the authenticated business

---

## 2. Recommended Provider Strategy and Prerequisites

### 2.1 Design Principle: Provider-Agnostic Adapter

The conversational AI layer must be built as a **provider-agnostic adapter** — a single interface that can swap between providers by changing an environment variable, without touching service code. This mirrors the pattern already established in `marketingGen.js` (detect provider from env, fall back gracefully).

**Proposed env vars (to be added to `.env` and `.env.example` in implementation, NOT now):**

```env
# --- LLM / Conversational AI ---
# Provider: openai | anthropic | gemini | deepseek | ollama | none
LLM_PROVIDER=none
# API key (not needed for ollama)
LLM_API_KEY=
# Model name (provider-specific)
LLM_MODEL=
# Base URL (for OpenAI-compatible endpoints: ollama, deepseek, openai-compatible proxies)
LLM_BASE_URL=
# Max tokens for response
LLM_MAX_TOKENS=1024
# Temperature (0 = deterministic, 1 = creative)
LLM_TEMPERATURE=0.3
# Request timeout in ms
LLM_TIMEOUT_MS=15000
```

When `LLM_PROVIDER=none` (or key is missing), the system falls back to the existing rule-based coordinator — **no degradation, no crash, no error to the user.** This means the LLM layer is an enhancement, not a dependency.

### 2.2 Recommended Providers

| Provider | API Style | Cost (per 1M tokens) | Key Advantage | Key Risk |
|---|---|---|---|---|
| **OpenAI** (gpt-4o-mini) | OpenAI REST | ~$0.15 in / ~$0.60 out | Best tool-calling support, well-documented | US-based, billing required |
| **Anthropic** (Claude 3.5 Haiku) | Anthropic REST | ~$0.25 in / ~$1.25 out | Excellent reasoning, long context | US-based, billing required |
| **Google Gemini** (1.5 Flash) | Google REST | ~$0.075 in / ~$0.30 out | Cheapest, generous free tier | Less mature tool-calling API |
| **DeepSeek** (deepseek-chat) | OpenAI-compatible | ~$0.14 in / ~$0.28 out | Available in China, cheap | Smaller ecosystem, less tested |
| **Ollama** (local: llama3.2, qwen2.5) | OpenAI-compatible | **Free** | No external dependency, private | Lower capability, requires local GPU/CPU, slower |

**Primary recommendation for development:** Start with **Ollama** (local, free, no API key, no billing) to develop and test the adapter. The OpenAI-compatible API means the same `fetch()` code works for both Ollama and OpenAI — just change `LLM_BASE_URL` from `http://localhost:11434/v1` to `https://api.openai.com/v1`.

**Primary recommendation for production:** **OpenAI gpt-4o-mini** for best tool-calling reliability, or **DeepSeek** if China availability is required. Both use the OpenAI-compatible API format.

**Fallback chain (automatic):**
```
LLM_PROVIDER configured + key present → call LLM API
    ↓ (on failure: timeout, 429, 500, network error)
Fall back to rule-based coordinator (existing matchIntents + execute)
    ↓ (always works — it's just SQL queries)
Return coordinator result with note: "Processed via local rules (LLM unavailable)"
```

### 2.3 Why No SDK Installation Is Needed

Node.js 22.22.2 has a built-in global `fetch()` that supports everything needed for LLM API calls:
- `fetch(url, { method, headers, body })` — standard HTTP POST
- `AbortController` for timeout — built into Node 22
- `ReadableStream` for streaming responses — built into Node 22
- `JSON.parse()` for response parsing — built-in

The OpenAI-compatible REST API format (used by OpenAI, DeepSeek, Ollama, LM Studio, and many proxies) is a simple JSON POST:

```javascript
// Conceptual — NOT to be implemented now
const response = await fetch(`${baseUrl}/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model: llmModel,
    messages: conversationMessages,
    tools: toolDefinitions,        // OpenAI function-calling format
    tool_choice: "auto",
    max_tokens: 1024,
    temperature: 0.3,
  }),
  signal: timeoutSignal,           // AbortController
});
const data = await response.json();
```

**No npm install required.** Zero new dependencies in `package.json`. The adapter is pure native JavaScript using `fetch()`. This is the lightest possible integration — no SDK version conflicts, no transitive dependencies, no security advisories from AI SDK packages.

### 2.4 Prerequisites Checklist (For Implementation Phase — Not This Stage)

| Prerequisite | Status | Action Needed |
|---|---|---|
| Node 22 runtime with global `fetch()` | ✅ Available | None |
| `fetch()` timeout mechanism | ✅ `AbortController` built-in | Use in adapter |
| LLM API key (for hosted providers) | ❌ Not configured | User must obtain and add to `.env` |
| Ollama installed locally (for free dev) | ❓ Unknown | User installs if choosing local development |
| `.env.example` updated with LLM vars | ❌ Not present | Add during implementation |
| Rate limiting for LLM calls | ❌ Not present | Add per-user LLM rate limit middleware |
| Error handling for provider failures | ❌ Not present | Design in adapter (Section 4) |
| Audit logging for LLM calls | ✅ Infrastructure exists | Use `audit_logs` table |

---

## 3. Proposed Backend and Frontend Message Flow

### 3.1 Design Principle: New Endpoint Alongside Existing

The existing `POST /api/businesses/:businessId/agent/runs` endpoint and the rule-based coordinator must remain fully functional. The conversational AI layer adds a **new endpoint** alongside it:

```
POST /api/businesses/:businessId/agent/chat    ← NEW: LLM-powered conversational
POST /api/businesses/:businessId/agent/runs    ← EXISTING: rule-based coordinator (unchanged)
```

**Rationale:**
- No regression risk — existing coordinator path is untouched
- Gradual migration — frontend can call `/agent/chat` when LLM is available, fall back to `/agent/runs` when not
- Clear separation — `/agent/runs` is transactional (one question → one report), `/agent/chat` is conversational (multi-turn with context)
- The existing agent run infrastructure (`agent_runs`, `agent_run_steps`, `audit_logs`) is reused for `/agent/chat` as well

### 3.2 Proposed Request/Response Contract

**Request (frontend → backend):**

```json
POST /api/businesses/:businessId/agent/chat
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "Which products are running low?",
  "conversation": [
    { "role": "user", "text": "Show me my inventory summary" },
    { "role": "assistant", "text": "You have 47 active products..." }
  ],
  "module": "inventory"
}
```

| Field | Type | Required | Validation | Purpose |
|---|---|---|---|---|
| `message` | string | Yes | 1–1000 chars, trimmed | Current user question |
| `conversation` | array | No | Max 20 items, each `{role, text}`, text max 2000 chars | Conversation history for context (last N turns) |
| `module` | string | No | One of: financial, inventory, task_allocation, marketing | Current module context (helps LLM understand domain) |

**Response (backend → frontend):**

```json
{
  "agent_run_id": "uuid",
  "status": "completed",
  "reply": "You have 5 products below their minimum stock threshold:\n\n1. Widget A (SKU: WA-001) — 3 units left, threshold 10\n2. Gadget B (SKU: GB-014) — 0 units left, threshold 5\n...\n\nWould you like me to check which supplier to reorder from?",
  "tool_calls": [
    {
      "tool": "low_stock",
      "summary": "5 products below threshold",
      "step_number": 1
    }
  ],
  "provider": "openai",
  "model": "gpt-4o-mini",
  "tokens_used": { "input": 342, "output": 156 }
}
```

| Field | Type | Purpose |
|---|---|---|
| `agent_run_id` | UUID | Links to `agent_runs` record for audit trail |
| `status` | string | `completed` / `failed` / `fallback` |
| `reply` | string | Natural-language response from LLM (or coordinator fallback) |
| `tool_calls` | array | Which business data tools were called and their summaries (for transparency) |
| `provider` | string | Which LLM provider was used (`openai`, `ollama`, `coordinator` for fallback) |
| `model` | string | Specific model name (for audit/debugging) |
| `tokens_used` | object | Token consumption (for cost monitoring) — null when fallback |

### 3.3 Backend Processing Flow

```
1. Receive POST /agent/chat
   ↓
2. Authenticate (authenticateToken + requireBusinessAccess)
   → req.businessId, req.user.userId extracted from JWT path
   ↓
3. Validate request body (Zod schema: message 1-1000 chars, conversation max 20 items)
   ↓
4. Create agent_run (status='planning', goal=message, plan=conversation context in JSONB)
   ↓
5. Check LLM availability:
   IF LLM_PROVIDER !== 'none' AND LLM_API_KEY is set:
     → Route to LLM conversational service (Section 3.4)
   ELSE:
     → Fall back to existing coordinator (runCoordinator with goal=message)
     → Format coordinator output as conversational reply
     → Return { status: 'fallback', provider: 'coordinator', reply: summary }
   ↓
6. Return response to frontend
   ↓
7. Audit log: record agent_run completion + any tool calls as agent_run_steps
```

### 3.4 LLM Conversational Service Flow (Inside Step 5 Above)

```
5a. Build LLM message array:
    - System prompt (see Section 3.5)
    - Conversation history (from request, mapped to {role, content})
    - Current user message

5b. Build tool definitions:
    - Map the 11 existing intents to OpenAI function-calling format
    - Each tool: { type: 'function', function: { name, description, parameters } }
    - Parameters derived from each intent's expected inputs (most need no params — businessId is injected server-side)

5c. Call LLM API:
    - fetch(LLM_BASE_URL + '/chat/completions', { ... })
    - With timeout (AbortController, LLM_TIMEOUT_MS)
    - With retry: 1 retry on 429/500, then fall back to coordinator

5d. Process LLM response:
    IF response has tool_calls:
      - For each tool call:
        - Validate tool name against allowed list (11 intents)
        - Inject businessId (from auth, NEVER from LLM)
        - Call intent.execute(businessId, goal)
        - Record as agent_run_step (agent_type='inventory'/'financial'/etc.)
        - Send tool result back to LLM for natural-language synthesis
      - Get final LLM response (natural-language summary of tool results)
    ELSE (direct text response):
      - Use as reply directly (greetings, clarifications, general advice)

5e. Handle errors:
    - Timeout → fall back to coordinator
    - 401/403 (invalid key) → fall back to coordinator, log error
    - 429 (rate limited) → fall back to coordinator, log warning
    - 500 (provider error) → fall back to coordinator, log error
    - Network error → fall back to coordinator, log error
```

### 3.5 System Prompt Design

The system prompt is the critical instruction that shapes LLM behavior. It must:
- Establish the assistant's role (business operations assistant)
- Provide business context (business name, module)
- Explain available tools (the 11 intents)
- Enforce safety rules (never invent data, always use tools, acknowledge gaps)
- Set tone (professional, concise, helpful)

**Conceptual system prompt (to be refined during implementation):**

```
You are BUSYNESS AI, a business operations assistant for {businessName}.
The user is currently viewing the {module} module.

You have access to real-time business data through tools. Always use tools to
answer questions about inventory, finances, tasks, team, customers, or marketing.
Never invent numbers, product names, or business data — if you don't have the
data, say so and suggest which tool could retrieve it.

Available tools:
- low_stock: Find products below their minimum stock threshold
- inventory_summary: Get overall inventory statistics
- product_search: Search products by name or SKU
- near_expiry: Find products near their expiry date
- stock_movement_history: Get recent stock movement records
- inventory_by_supplier: Get inventory grouped by supplier
- task_overview: Get current task statistics
- team_workload: Get team member workload distribution
- financial_overview: Get revenue, expenses, and profit summary
- customer_summary: Get customer statistics
- marketing_overview: Get marketing project summary

Rules:
1. Always call a tool before answering data questions. Never guess.
2. If a question is unclear, ask for clarification.
3. If a question is outside business operations (greetings, thanks), respond naturally without tools.
4. Keep responses concise and structured. Use lists for multiple items.
5. After presenting data, offer a relevant follow-up question.
6. Never share raw SQL or internal system details.
```

### 3.6 Frontend Message Flow (Proposed Changes to ModulePage.jsx)

**Current flow (unchanged):**
```
ChatInput → handleAsk(question) → POST /agent/runs { goal: question } → extract summary string → append to thread
```

**Proposed flow (new, when LLM is available):**
```
ChatInput → handleAsk(question) → POST /agent/chat { message, conversation: lastN(thread), module } →
  extract { reply, tool_calls, provider } →
  append to thread as { role: 'assistant', text: reply, tools: tool_calls, provider }
```

**Key frontend changes:**
1. `handleAsk` sends `conversation` array (last 10 messages from `thread`) alongside `message`
2. API endpoint changes from `/agent/runs` to `/agent/chat`
3. Response extraction changes from `res.final_report.summary` to `res.reply`
4. Thread messages gain optional `tools` and `provider` metadata (for future UI enhancement — showing which tools were called)
5. Fallback: if `/agent/chat` returns `status: 'fallback'`, display a subtle indicator that the response came from local rules, not the LLM

**What does NOT change:**
- `ChatInput.jsx` — no changes needed, it already calls `onSend(question)` which routes to `handleAsk`
- Voice recognition — transcripts still become text and go through `handleAsk`
- File attachment — still client-side only (file processing by LLM is a future phase)
- Thread is still in-memory `useState` (persistence is Phase 3, see Section 7)
- Page refresh still clears the thread (acceptable for initial milestone)

### 3.7 Streaming (Future Enhancement — Not Phase 1)

The proposed flow uses a single JSON response (no streaming). This is simpler and sufficient for the first milestone. Streaming via Server-Sent Events (SSE) or fetch streaming is a Phase 2 enhancement:

- **Phase 1 (proposed):** Single request → single response. User sees "Processing…" spinner. Average LLM response time: 2-5 seconds.
- **Phase 2 (future):** Stream tokens as they arrive. User sees text appear incrementally. Requires `ReadableStream` parsing on frontend and SSE or chunked transfer on backend.

---

## 4. Tool-Calling and Authorisation Design

### 4.1 The Core Security Principle: BusinessId Never Crosses the LLM Boundary

The single most important security design rule:

> **The LLM never receives, produces, or controls `businessId`.** The authenticated business ID is injected server-side into every tool execution. The LLM selects *which* tool to call and may suggest *parameters* (like a search query string), but the business scope is always applied by the backend, never by the LLM.

This is already how the system works — `intent.execute(businessId, goal)` receives `businessId` from the coordinator, which gets it from `req.businessId` (set by `requireBusinessAccess` middleware from the JWT). The LLM layer simply replaces the `matchIntents()` substring matcher with an LLM tool-call, but the execution path remains identical.

### 4.2 Tool Definition Format (OpenAI Function Calling)

Each of the 11 existing intents becomes a tool definition. Example for `low_stock`:

```json
{
  "type": "function",
  "function": {
    "name": "low_stock",
    "description": "Find products whose current stock quantity is at or below their minimum stock threshold. Returns product name, SKU, current stock, threshold, and severity.",
    "parameters": {
      "type": "object",
      "properties": {},
      "required": []
    }
  }
}
```

Most inventory/financial/task tools need **no parameters** — they operate on `businessId` alone (injected server-side). The LLM just needs to know what each tool does so it can choose the right one.

**Tools that accept LLM-suggested parameters:**

| Tool | LLM-suggested param | Server validation | Server-injected param |
|---|---|---|---|
| `product_search` | `query` (search string) | Zod: string, 1-100 chars, no SQL wildcards | `businessId` |
| `stock_movement_history` | `product_name` (optional filter) | Zod: string, optional, 1-200 chars | `businessId` |
| `inventory_by_supplier` | `supplier_name` (optional filter) | Zod: string, optional, 1-200 chars | `businessId` |

All other 8 tools take no parameters at all — they are pure business-scoped aggregate queries.

### 4.3 Tool Execution Pipeline

```
LLM requests tool call: { name: "product_search", arguments: { query: "widget" } }
    ↓
Step 1: Validate tool name
   - Check against ALLOWED_TOOLS set (hardcoded list of 11 intent IDs)
   - Reject any tool name not in the set (LLM hallucination protection)
    ↓
Step 2: Validate arguments with Zod
   - Each tool has a Zod schema for its arguments
   - Reject if validation fails
   - Sanitize string inputs (strip SQL wildcards, limit length)
    ↓
Step 3: Inject businessId (from auth context, never from LLM)
    ↓
Step 4: Call intent.execute(businessId, validatedArgs)
   - This runs the existing parameterized SQL query
   - businessId is always $1 in the SQL — never user/LLM controlled
    ↓
Step 5: Limit result size
   - All queries already use LIMIT (typically 20-50 rows)
   - If result exceeds limit, truncate and add "showing first N results" note
    ↓
Step 6: Format tool result for LLM
   - Convert SQL rows to a concise JSON string
   - Include row count and summary
   - Send back to LLM as tool result message
    ↓
Step 7: Record as agent_run_step
   - agent_type: from the intent's agent_type field
   - input: { tool_name, arguments } (JSONB)
   - output: { row_count, data } (JSONB) — or truncated data
   - evidence: { sql_used, execution_time_ms } (JSONB)
    ↓
Step 8: Record in audit_logs
   - action: 'tool_call'
   - source: 'llm_conversational'
   - entity_type: the tool name
   - details: { arguments, row_count } (JSONB)
```

### 4.4 Safety Guarantees

| Risk | Mitigation |
|---|---|
| LLM hallucinates a tool name | ALLOWED_TOOLS whitelist — unknown tools are rejected |
| LLM injects malicious parameters | Zod validation on every argument — type, length, format |
| LLM attempts SQL injection through parameters | Parameters go through parameterized SQL ($1, $2) — never string interpolation. ILIKE wildcards are escaped (existing fix from Phase 10B) |
| LLM tries to access another business's data | `businessId` comes from JWT auth, never from LLM. Every SQL query uses `WHERE business_id = $1` with the auth-scoped ID |
| LLM returns inappropriate content | System prompt includes content guidelines. Response is displayed as-is (no HTML rendering — `whitespace-pre-wrap` only). Future: add response filtering |
| LLM attempts to call write/delete operations | All 11 existing intents are READ-ONLY. No INSERT/UPDATE/DELETE tools are exposed to the LLM. The trigger protections (migration 007) block direct stock_quantity updates at the DB level |
| LLM makes excessive tool calls | Max 5 tool calls per conversation turn (configurable). After 5, return results and ask user to narrow the question |
| LLM calls take too long | AbortController timeout (LLM_TIMEOUT_MS, default 15s). On timeout, fall back to coordinator |

### 4.5 Read-Only Enforcement

**Critical safety property:** The conversational AI layer is **strictly read-only** in Phase 1. The LLM can only call tools that execute `SELECT` queries. No tools are exposed that modify data.

This is enforced at three levels:
1. **Tool whitelist:** Only the 11 existing read-only intents are registered as tools
2. **Intent execute functions:** All 11 execute functions only run `SELECT` queries (verified in Phase 10B audit)
3. **Database triggers:** Migration 007's `prevent_update_delete()` trigger blocks all UPDATE/DELETE on `stock_movements` and `audit_logs`, and `protect_stock_quantity()` blocks direct UPDATE of `products.stock_quantity`. Even if a tool were compromised, the database would reject the write.

**Future write-capable tools (Phase 3+):** Tools that create purchase orders, adjust stock, or assign tasks would require:
- A new `approval_requests` flow (the infrastructure already exists)
- Human-in-the-loop confirmation before execution
- Separate tool registration with explicit `write` capability flag
- This is explicitly out of scope for Phase 1

---

## 5. Conversation-Context Strategy

### 5.1 Phase 1: Stateless Context (No Schema Changes)

The initial implementation uses **stateless conversation context** — the frontend sends the last N messages with each request, and the backend passes them to the LLM. No database tables are added. No schema migrations are needed.

**Frontend-side context management:**

```javascript
// In ModulePage.jsx handleAsk (conceptual — NOT to be implemented now)
const conversation = thread
  .slice(-10)                           // Last 10 messages
  .map(m => ({ role: m.role, text: m.text }));

const res = await api.post(`/api/businesses/${business.id}/agent/chat`, {
  message: question,
  conversation,                          // Send context
  module,                                // Current module
});
```

**Backend-side context handling:**

```javascript
// In the LLM conversational service (conceptual — NOT to be implemented now)
const llmMessages = [
  { role: "system", content: systemPrompt },
  ...conversation.map(m => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.text,
  })),
  { role: "user", content: message },     // Current question
];
```

**Why this works for Phase 1:**
- No schema migration needed — zero risk to existing data
- Context is naturally scoped to the current page session (refresh = new conversation, which is acceptable)
- Token budget is controllable (10 messages × ~200 tokens = ~2000 tokens of context, well within limits)
- Simple to implement and test

**Limitations of stateless context:**
- Thread lost on page refresh (acceptable — users expect this from chat UIs)
- No cross-device sync (acceptable for MVP)
- No conversation history search (future feature)
- Context limited to 10 messages (configurable, but more = higher token cost)

### 5.2 Phase 2 (Future): Server-Side Context with Schema Changes

For persistent conversations that survive refresh and sync across devices, new tables would be needed:

```sql
-- NOT to be created now — future phase, requires separate approval
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module VARCHAR(50),          -- which module hub started the conversation
  title VARCHAR(200),          -- auto-generated from first message
  status VARCHAR(20) DEFAULT 'active',  -- active | archived
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  tool_calls JSONB,            -- tools called for this message (if assistant)
  provider VARCHAR(50),       -- which LLM provider was used
  tokens_used JSONB,          -- { input, output }
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**This would enable:**
- Conversation persistence across refresh and devices
- Conversation history list/search
- Longer context windows (load from DB, not limited to in-memory)
- Export conversation transcripts

**However, this is explicitly Phase 2+ and requires separate approval.** Phase 1 uses stateless context only.

### 5.3 Alternative: Repurpose Existing JSONB Columns (No Migration)

The `agent_runs` table has two JSONB columns that are currently unused or underused:

| Column | Current Use | Potential Reuse |
|---|---|---|
| `plan` | NULL (never populated) | Store conversation context snapshot: `{ conversation: [...], module: "inventory" }` |
| `final_report` | Stores `{ summary, matched_intents, step_count }` | Extend with `{ reply, tool_calls, provider, tokens_used }` |

This allows recording the conversation context that was sent with each agent run **without any schema migration**. The data is already JSONB — just store more fields in it.

**`agent_runs.retry_of`** (self-referencing FK) could link a follow-up turn to the previous turn in the same conversation, creating a chain of related runs. This is a creative reuse of an existing column, not its intended purpose, but it works without migration.

### 5.4 Context Window and Token Budget

| Component | Estimated Tokens | Notes |
|---|---|---|
| System prompt | ~400 | Role, tools, rules |
| Tool definitions | ~300 | 11 tools × ~27 tokens each |
| Conversation history (10 messages) | ~2,000 | ~200 tokens per message |
| Current user message | ~100 | Typical question |
| **Total input** | **~2,800** | Well within gpt-4o-mini's 128K context |
| LLM response (with tool call) | ~200 | Tool selection + reasoning |
| Tool result (data) | ~500 | Query results in JSON |
| LLM final synthesis | ~300 | Natural-language summary |
| **Total output** | **~1,000** | Within LLM_MAX_TOKENS=1024 |

**Cost per turn (gpt-4o-mini, estimated):**
- Input: 2,800 tokens × $0.15/1M = $0.00042
- Output: 1,000 tokens × $0.60/1M = $0.00060
- **Total: ~$0.001 per conversation turn** (~$1 per 1,000 turns)

With Ollama (local): **$0.00 per turn** (free, but slower and less capable).

---

## 6. Files Expected to Change in Later Implementation

> **These files will be modified during the IMPLEMENTATION phase (after approval), NOT during this inspection stage.**

### 6.1 Backend Files — New

| File | Purpose | Estimated Size |
|---|---|---|
| `backend/src/services/llmAdapter.js` | Provider-agnostic LLM adapter. Exports `callLLM({ messages, tools, businessId })`. Handles fetch, timeout, retry, fallback. No SDK — uses native `fetch()`. | ~200 lines |
| `backend/src/services/conversationalAgent.js` | Orchestrates LLM conversation: builds system prompt, maps intents to tool definitions, processes tool calls, formats response. Calls `llmAdapter` and existing intent `execute` functions. | ~250 lines |
| `backend/src/services/toolRegistry.js` | Maps the 11 existing intents to OpenAI function-calling format. Validates tool names and arguments with Zod. Injects `businessId` server-side. | ~150 lines |

### 6.2 Backend Files — Modified

| File | Change | Risk |
|---|---|---|
| `backend/src/routes/agent.js` | Add `POST /agent/chat` endpoint alongside existing `POST /agent/runs`. New endpoint calls `conversationalAgent.run()` instead of `coordinator.runCoordinator()`. Existing endpoint unchanged. | Low — additive, no existing code modified |
| `backend/src/services/coordinator.js` | No functional changes. May export a `formatCoordinatorReply(goal, result)` helper that the conversational agent can use when falling back. | Very low — additive export only |
| `backend/.env` | Add LLM env vars (`LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`, etc.) | Low — additive vars, existing vars untouched |
| `backend/.env.example` | Add the same LLM vars with placeholder values and comments | Low — documentation only |
| `backend/src/app.js` | Add per-user rate limit middleware for `/agent/chat` (e.g., 30 requests/minute) to prevent LLM cost abuse | Low — additive middleware |

### 6.3 Frontend Files — Modified

| File | Change | Risk |
|---|---|---|
| `frontend/src/components/ModulePage.jsx` | `handleAsk` sends `conversation` array alongside `message`. API endpoint changes to `/agent/chat`. Response extraction changes from `final_report.summary` to `reply`. Thread messages gain optional `tools` and `provider` metadata. | Medium — core chat flow changes, but structure preserved |
| `frontend/src/api/client.js` | No changes needed — existing `api.post()` works for the new endpoint | None |
| `frontend/src/components/ChatInput.jsx` | No changes needed — already calls `onSend(question)` which routes through `handleAsk` | None |

### 6.4 Files NOT Changed

| File | Reason |
|---|---|
| `backend/src/services/inventoryAgent.js` | Intent execute functions are reused as-is. They are the "tools." No changes needed. |
| `backend/src/services/marketingGen.js` | Separate concern (marketing content generation, not conversational chat). May be enhanced in future phase. |
| `backend/src/middleware/auth.js` | Auth flow unchanged — LLM layer uses same JWT auth |
| `backend/src/middleware/businessAuth.js` | Business access check unchanged — LLM layer uses same business scoping |
| `backend/src/db/pool.js` | Database connection pool unchanged |
| All migration files | No schema changes in Phase 1 |
| `backend/src/db/seed.js` | Seed data unchanged |
| `frontend/src/context/AuthContext.jsx` | Auth context unchanged |
| `frontend/src/hooks/useVoiceRecognition.js` | Voice hook unchanged — transcripts become text as before |
| All other frontend components | Only ModulePage.jsx changes in the chat flow |

### 6.5 Dependency Changes

| Action | Package | Reason |
|---|---|---|
| **ADD** | None | Native `fetch()` is used — no SDK needed |
| **REMOVE** | None | No existing packages are removed |
| **UPDATE** | None | No existing packages are upgraded |

**Zero dependency changes.** This is a key advantage of using Node 22's native `fetch()` instead of an LLM SDK.

---

## 7. Minimal First Milestone, Follow-Up Phases, Test Matrix, Cost/Privacy/Reliability/Risks

### 7.1 Implementation Phases

#### Phase 1 (Minimal First Milestone) — LLM Conversational Layer

**Scope:** Add a working conversational AI layer that can answer business questions naturally, using the existing 11 read-only tools, with conversation context.

| Deliverable | Description |
|---|---|
| `llmAdapter.js` | Provider-agnostic adapter with native `fetch()`, timeout, retry, fallback to coordinator |
| `toolRegistry.js` | 11 intents mapped to OpenAI function-calling format, Zod validation, businessId injection |
| `conversationalAgent.js` | Orchestrator: system prompt, tool-call loop, response formatting |
| `POST /agent/chat` endpoint | New route alongside existing `/agent/runs` |
| `ModulePage.jsx` update | Send conversation context, call `/agent/chat`, extract `reply` |
| `.env` / `.env.example` update | Add LLM env vars |
| Rate limiting | Per-user LLM rate limit on `/agent/chat` |
| Tests | 10 test scenarios (Section 7.3) |

**Acceptance criteria:**
1. User can ask a natural-language business question and get a natural-language answer
2. LLM calls the correct tool(s) and synthesizes results into prose
3. Follow-up questions work (LLM understands context from conversation history)
4. When LLM is unavailable, system falls back to coordinator with no error
5. All tool calls are audited in `agent_logs` and `agent_run_steps`
6. No existing functionality breaks (all existing tests pass)

#### Phase 2 — Enhanced Tools and Streaming

| Deliverable | Description |
|---|---|
| New inventory tools | Add restocking recommendations, stockout risk, fast/slow movers (from Stage 1 design report) as LLM-callable tools |
| Streaming responses | SSE or chunked transfer for incremental text display |
| Response rich formatting | Render tables, bullet lists, simple charts in chat UI |
| Cross-module tools | LLM can call tools from any module regardless of current page |
| Conversation persistence | New `conversations` and `conversation_messages` tables (requires migration approval) |

#### Phase 3 — Write-Capable Tools and Approval Flow

| Deliverable | Description |
|---|---|
| Write tools | Create purchase orders, adjust stock, assign tasks — behind approval flow |
| Human-in-the-loop | `approval_requests` table used to gate LLM-proposed actions |
| Multi-step workflows | LLM can plan multi-step actions (e.g., "reorder all low-stock items from their suppliers") |
| Conversation history UI | List, search, resume past conversations |
| Cost dashboard | Monitor token usage and cost per business |

### 7.2 Cost Analysis

#### Per-Turn Cost (gpt-4o-mini, estimated)

| Component | Tokens | Rate ($/1M) | Cost |
|---|---|---|---|
| Input (system + context + tools + message) | ~2,800 | $0.15 | $0.00042 |
| Output (tool call + synthesis) | ~1,000 | $0.60 | $0.00060 |
| **Total per turn** | ~3,800 | — | **~$0.001** |

**Monthly cost estimates (gpt-4o-mini):**

| Usage Level | Turns/day | Turns/month | Monthly cost |
|---|---|---|---|
| Light (1 user, occasional) | 10 | 300 | ~$0.30 |
| Moderate (1 user, regular) | 50 | 1,500 | ~$1.50 |
| Heavy (5 users, regular) | 250 | 7,500 | ~$7.50 |
| Very heavy (10 users, heavy) | 500 | 15,000 | ~$15.00 |

**With Ollama (local):** $0.00/month for all usage levels. Trade-off: lower response quality, slower (5-15s per turn depending on hardware), requires local GPU/CPU.

**With DeepSeek:** ~50-70% cheaper than gpt-4o-mini. ~$0.0003-0.0007 per turn.

**Cost control measures:**
1. Per-user rate limiting (30 requests/minute default)
2. Conversation context capped at 10 messages (token budget)
3. `LLM_MAX_TOKENS=1024` caps output tokens
4. Fallback to free coordinator when LLM fails or rate limit hit
5. `tokens_used` in response enables monitoring (future cost dashboard)

### 7.3 Test Matrix — 10 Specific Test Scenarios

These 10 test scenarios define the acceptance criteria for Phase 1. Each can be executed manually or via automated test.

#### Scenario 1: Greeting

| Aspect | Detail |
|---|---|
| **Input** | `message: "Hi there!"`, `conversation: []`, `module: "inventory"` |
| **Expected behavior** | LLM responds with a natural greeting and offers to help with business questions. Does NOT call any tools. |
| **Expected response shape** | `{ status: "completed", reply: "Hello! I'm your business assistant...", tool_calls: [], provider: "openai" }` |
| **Pass criteria** | Reply is a natural greeting, mentions the business assistant role, offers help. No tool calls recorded. |
| **Fallback behavior** | If LLM unavailable: coordinator's `formatFallbackResponse` lists capabilities. Reply: "I can help you with..." |

#### Scenario 2: Natural-Language Inventory Query

| Aspect | Detail |
|---|---|
| **Input** | `message: "Which products are running low on stock?"`, `conversation: []`, `module: "inventory"` |
| **Expected behavior** | LLM calls `low_stock` tool. Backend executes the existing SQL query with auth-scoped `businessId`. LLM synthesizes results into natural-language prose with product names and quantities. |
| **Expected response shape** | `{ status: "completed", reply: "You have 5 products below their minimum stock threshold:\n1. Widget A...", tool_calls: [{ tool: "low_stock", summary: "5 products below threshold" }], provider: "openai" }` |
| **Pass criteria** | Tool call recorded in `agent_run_steps`. Reply contains real product names and stock levels from the database. Reply is prose, not raw JSON. |
| **Fallback behavior** | If LLM unavailable: coordinator's `low_stock` intent matches "low stock" pattern, runs same SQL, returns formatted summary. |

#### Scenario 3: Follow-Up Question (Context Dependence)

| Aspect | Detail |
|---|---|
| **Input** | `message: "Which supplier should I reorder from?"`, `conversation: [{ role: "user", text: "Which products are running low on stock?" }, { role: "assistant", text: "You have 5 products below threshold: Widget A, Gadget B..." }]`, `module: "inventory"` |
| **Expected behavior** | LLM understands "which supplier" refers to the low-stock products from the previous turn. Calls `inventory_by_supplier` tool (or combines `low_stock` + `inventory_by_supplier`). Synthesizes answer referencing the specific products from context. |
| **Expected response shape** | `{ status: "completed", reply: "For the 5 low-stock products I found:\n- Widget A: supplied by Acme Corp\n- Gadget B: supplied by Beta Distributors...", tool_calls: [{ tool: "inventory_by_supplier", ... }], provider: "openai" }` |
| **Pass criteria** | LLM uses conversation context to understand the follow-up. Does NOT ask "which products?" — it remembers from context. Reply references specific products mentioned in previous turn. |
| **Fallback behavior** | If LLM unavailable: coordinator matches "by supplier" → runs `inventory_by_supplier` intent. Loses context connection to low-stock products but still returns supplier data. |

#### Scenario 4: Missing Data (Empty Results)

| Aspect | Detail |
|---|---|
| **Input** | `message: "Show me products near expiry"`, `conversation: []`, `module: "inventory"` (assuming no products have expiry dates set) |
| **Expected behavior** | LLM calls `near_expiry` tool. Tool returns empty result set. LLM responds honestly: no products have expiry dates configured. Suggests setting expiry dates for perishable products. |
| **Expected response shape** | `{ status: "completed", reply: "No products currently have expiry dates set. If you carry perishable goods, I'd recommend adding expiry dates to your product records so I can alert you before they expire.", tool_calls: [{ tool: "near_expiry", summary: "0 products near expiry" }], provider: "openai" }` |
| **Pass criteria** | LLM does NOT invent products or expiry dates. Honestly reports no data. Offers helpful suggestion. Tool call still recorded (even with empty results). |
| **Fallback behavior** | Coordinator's `near_expiry` intent returns "No products near expiry." — less helpful but accurate. |

#### Scenario 5: Unclear Question (Clarification Request)

| Aspect | Detail |
|---|---|
| **Input** | `message: "What about the thing?"`, `conversation: []`, `module: "inventory"` |
| **Expected behavior** | LLM does NOT call any tools. Asks for clarification: what "thing" refers to. Offers examples of what it can help with. |
| **Expected response shape** | `{ status: "completed", reply: "I'm not sure what you mean by 'the thing'. Could you clarify? For example, I can help you with:\n- Low stock products\n- Inventory summary\n- Products near expiry\n- Stock movement history\nWhat would you like to know?", tool_calls: [], provider: "openai" }` |
| **Pass criteria** | No tool calls recorded. Reply asks for clarification. Reply offers relevant examples based on current module. |
| **Fallback behavior** | Coordinator's `matchIntents` finds no match → `formatFallbackResponse` lists all 11 capabilities. Less contextually relevant but functional. |

#### Scenario 6: Cross-Business Access (Security Boundary)

| Aspect | Detail |
|---|---|
| **Input** | User A (authenticated for Business X) sends `message: "Show me all products"`. LLM (if compromised/hallucinating) might try to call `product_search` with `arguments: { businessId: "uuid-of-business-Y" }`. |
| **Expected behavior** | Backend **ignores** any `businessId` in LLM arguments. Uses `req.businessId` from JWT auth (Business X). Query runs `WHERE business_id = $1` with Business X's ID. LLM only sees Business X's products. |
| **Expected response shape** | `{ status: "completed", reply: "Here are products in your business: ...", tool_calls: [{ tool: "product_search", ... }] }` — only Business X's products, never Business Y's. |
| **Pass criteria** | Response contains ONLY products from the authenticated business. Even if LLM suggests a different businessId, the actual SQL query uses the auth-scoped ID. Verify in `agent_run_steps.output` that data is from the correct business. |
| **Fallback behavior** | Coordinator always uses `req.businessId` — no cross-business leak possible. |
| **Test method** | Create two businesses with different products. Authenticate as Business A. Ask for products. Verify only Business A's products appear. |

#### Scenario 7: Provider Failure (Graceful Degradation)

| Aspect | Detail |
|---|---|
| **Input** | `message: "Show me my inventory summary"`, with `LLM_PROVIDER=openai` but `LLM_API_KEY=invalid_key` (or network disconnected / provider down) |
| **Expected behavior** | LLM adapter attempts fetch, receives 401 (or timeout, or network error). Catches error, logs warning. Falls back to coordinator. Coordinator matches "inventory summary" intent, runs SQL, returns formatted result. User sees a response, not an error. |
| **Expected response shape** | `{ status: "fallback", reply: "You have 47 active products across 12 suppliers...", tool_calls: [{ tool: "inventory_summary", ... }], provider: "coordinator", tokens_used: null }` |
| **Pass criteria** | User receives a valid response (from coordinator). No error visible to user. `provider` field is `"coordinator"` (not `"openai"`). Error is logged server-side. `status` is `"fallback"`. |
| **Fallback behavior** | This IS the fallback behavior — coordinator runs the same query the LLM would have selected. |
| **Test method** | Set `LLM_API_KEY=invalid` in `.env`. Restart backend. Ask inventory question. Verify coordinator fallback works. |

#### Scenario 8: Regression (Existing Coordinator Still Works)

| Aspect | Detail |
|---|---|
| **Input** | `POST /api/businesses/:businessId/agent/runs { goal: "show low stock products" }` (the EXISTING endpoint, not the new one) |
| **Expected behavior** | Existing coordinator runs as before. `matchIntents("show low stock products")` matches `low_stock` intent. SQL query executes. `final_report.summary` is returned. No LLM is involved. |
| **Expected response shape** | Identical to pre-Phase 1 response: `{ agent_run_id, status: "completed", goal, steps: [...], final_report: { summary, matched_intents: ["low_stock"], step_count: 1, ... } }` |
| **Pass criteria** | Response is identical to the pre-Phase 1 coordinator response. No LLM-related fields appear. All existing tests pass. |
| **Test method** | Run the existing test suite (`npm test`). All tests must pass without modification. |

#### Scenario 9: Tool Safety (No Write Operations)

| Aspect | Detail |
|---|---|
| **Input** | `message: "Delete all products that are out of stock"` or `message: "Set Widget A's stock to 100"` |
| **Expected behavior** | LLM may attempt to call a tool, but no write/delete tool exists in the tool registry. The LLM either: (a) recognizes no tool can perform writes and responds that it cannot perform this action, or (b) hallucinates a tool name that is rejected by the ALLOWED_TOOLS whitelist. |
| **Expected response shape** | `{ status: "completed", reply: "I can't modify or delete product data — I only have read access to your inventory. To adjust stock, you can use the Stock Movements page to record a purchase or adjustment.", tool_calls: [], provider: "openai" }` |
| **Pass criteria** | No data is modified. No INSERT/UPDATE/DELETE SQL is executed. If LLM hallucinates a tool name, it is rejected by the whitelist. Database triggers (migration 007) provide a third layer of protection. Reply explains the limitation and offers an alternative. |
| **Fallback behavior** | Coordinator's `matchIntents` finds no match for "delete" or "set" → fallback response listing capabilities. |
| **Verification** | After the test, query the database to confirm no rows were modified in `products`, `stock_movements`, or any other table. |

#### Scenario 10: Conversation Isolation (Between Users/Businesses)

| Aspect | Detail |
|---|---|
| **Input** | User A (Business X) and User B (Business Y) are both using the chat simultaneously. User A asks "show my low stock". User B asks "show my low stock". |
| **Expected behavior** | Each request is independently authenticated. User A's LLM call uses Business X's data (via `req.businessId`). User B's LLM call uses Business Y's data. No conversation context leaks between users (context is sent per-request from frontend, not stored server-side in Phase 1). |
| **Expected response shape** | User A sees Business X's low-stock products. User B sees Business Y's low-stock products. Neither sees the other's data. |
| **Pass criteria** | User A's response contains only Business X's products. User B's response contains only Business Y's products. No cross-contamination of conversation context (each frontend sends its own `thread` state, which is per-browser-session). |
| **Test method** | Open two browser sessions (different users/businesses). Ask the same question in both. Verify each gets their own business's data. |

### 7.4 Privacy Analysis

| Concern | Assessment | Mitigation |
|---|---|---|
| **Business data sent to external LLM** | **Yes** — tool results (product names, stock levels, etc.) are sent to the LLM provider as tool-call results for natural-language synthesis. The LLM sees real business data. | This is inherent to LLM-powered chat. Mitigation: (1) Only send data that the tool returns — no full database dumps. (2) Results are LIMITed to 20 rows. (3) Use local Ollama for zero data leakage. (4) Document this in privacy policy. |
| **API key storage** | API key stored in `backend/.env` (gitignored). Never sent to frontend. | `.env` is in `.gitignore` (verified). Key only used server-side in `llmAdapter.js`. |
| **Conversation history on provider servers** | OpenAI/Anthropic may retain API inputs for 30 days (for abuse monitoring). Enterprise tier can opt out. | Use DeepSeek or local Ollama if retention is a concern. Document in privacy policy. |
| **User PII in LLM prompts** | System prompt contains business name (from DB). User messages may contain personal context. | Business name is not sensitive PII. User messages are user-initiated — they chose what to share. No automatic PII injection. |
| **Audit logs** | All LLM tool calls are logged in `audit_logs` (append-only, trigger-protected). Contains tool name, arguments, row count. | Does NOT log full LLM prompts/responses (too large, contains business data). Logs metadata only. Full prompt/response could be logged in a future compliance mode. |

### 7.5 Reliability Analysis

| Failure Mode | Probability | Impact | Mitigation |
|---|---|---|---|
| LLM provider timeout | Medium (network latency, rate limits) | User sees delayed response or fallback | AbortController timeout (15s) → fallback to coordinator. User always gets a response. |
| LLM provider 429 (rate limited) | Medium (high usage) | User cannot use LLM chat temporarily | Fallback to coordinator. Per-user rate limit prevents triggering provider rate limit. |
| LLM provider 500 (server error) | Low | User cannot use LLM chat | Retry once, then fallback to coordinator. Log error for monitoring. |
| LLM returns invalid tool call | Low (well-defined tool schema) | Tool call rejected, LLM asked to retry | Zod validation rejects invalid args. LLM gets error message and can self-correct. |
| LLM hallucinates tool name | Low (constrained by tool definitions) | Unknown tool rejected | ALLOWED_TOOLS whitelist. LLM gets "tool not found" message and can try again. |
| LLM produces inappropriate content | Low (system prompt guidelines) | User sees inappropriate text | System prompt includes content rules. Future: add response content filter. |
| Backend database unavailable | Low (Supabase SLA) | All queries fail | Existing error handling returns error message. LLM cannot answer data questions. |
| Invalid API key | Medium (misconfiguration) | LLM unavailable | Graceful fallback to coordinator. Server-side error log. |
| Network connectivity lost | Low (local dev) | LLM unavailable | Fallback to coordinator. |

### 7.6 Unresolved Questions and Risks

| # | Question/Risk | Impact | Recommendation |
|---|---|---|---|
| 1 | **Which LLM provider will the user choose?** | Determines cost, privacy, and capability profile | Start with Ollama for development (free, local). Choose hosted provider for production based on user preference. |
| 2 | **Will the user obtain an API key?** | Without a key, LLM layer is non-functional (always falls back to coordinator) | User must obtain key for hosted providers, or install Ollama for local. Document setup instructions. |
| 3 | **Is the `agent_type` CHECK constraint a blocker?** | Adding `llm` or `conversational` as `agent_type` in `agent_run_steps` requires ALTER TABLE (schema change) | Phase 1 workaround: use existing `agent_type` values (e.g., `inventory` for inventory tool calls, `coordinator` for LLM orchestration steps). No schema change needed. |
| 4 | **Should conversation context persist across refresh?** | Phase 1 loses thread on refresh (stateless). Users may find this annoying. | Acceptable for MVP. Phase 2 adds `conversations` table for persistence. |
| 5 | **How to handle multi-module conversations?** | User on Inventory page asks a financial question. Should LLM call financial tools? | Phase 1: LLM can call any of the 11 tools regardless of current module. `module` field is hint context, not a restriction. |
| 6 | **Token cost monitoring** | Without a cost dashboard, token usage is invisible | Phase 1: `tokens_used` in response. Phase 2: cost dashboard. Phase 1: log to console for monitoring. |
| 7 | **Streaming vs. non-streaming** | Non-streaming means 2-5s wait with spinner. Streaming improves UX. | Phase 1: non-streaming (simpler, sufficient). Phase 2: streaming. |
| 8 | **What if the LLM calls 5+ tools in one turn?** | Excessive tool calls increase cost and latency | Max 5 tool calls per turn (hardcoded limit). After 5, return results and ask user to narrow the question. |
| 9 | **Schema conflict: audit_logs ON DELETE SET NULL vs. prevent_update_delete trigger** | Businesses with audit_logs cannot be deleted (known unfixed issue from Phase 10B). LLM tool calls write to audit_logs, increasing the issue. | Not a Phase 1 blocker (affects business deletion, not chat functionality). Should be fixed separately. |
| 10 | **dotenv loading order bug** | `rateLimit.js` imported before `pool.js` (where `dotenv.config()` is called). Code defaults used instead of `.env` values. Currently harmless. | Not a Phase 1 blocker. Should be fixed separately by moving `dotenv.config()` to entry point. |

### 7.7 No-Change Confirmation

This stage has made **zero modifications** to:

- ✅ No code files modified
- ✅ No dependencies installed or removed
- ✅ No configuration files changed (`.env`, `.env.example`)
- ✅ No database schema changes (no migrations, no ALTER TABLE)
- ✅ No database data modified (no INSERT, UPDATE, DELETE)
- ✅ No external model API calls made (no API charges incurred)
- ✅ No new files created outside this report
- ✅ No tests modified or run against live system

This report is a design document only. Implementation will begin only after explicit user approval.

---

## Summary

**Current state:** BUSYNESS has zero LLM integration. The "AI" is entirely rule-based (substring matching → SQL queries). This is a clean foundation — no legacy AI code to migrate.

**Proposed architecture:**
1. A provider-agnostic LLM adapter using Node 22's native `fetch()` (no SDK needed)
2. The existing 11 coordinator intents wrapped as LLM-callable tools (read-only, business-scoped)
3. A new `POST /agent/chat` endpoint alongside the existing `POST /agent/runs`
4. Frontend sends conversation context (last 10 messages) with each request
5. Graceful fallback to the existing coordinator when LLM is unavailable
6. Zero dependency changes, zero schema changes, zero migration risk

**First milestone:** Working conversational AI that answers business questions naturally, understands follow-ups, and falls back gracefully — all auditable, all read-only, all business-scoped.

**Awaiting approval before any implementation.**
