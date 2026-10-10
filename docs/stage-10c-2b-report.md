# Phase 10C Stage 2B — Conversational AI Foundation

## Final Report

**Date:** 2026-10-11  
**Status:** Implementation complete. Stopping for review as instructed.

---

## Files Changed

### New Files Created

| File | Purpose |
|------|---------|
| `backend/src/services/llmProvider.js` | LLM provider adapter — mock fallback + live LLM placeholder, server-side tool allowlist, tool execution |
| `backend/src/services/conversation.js` | Conversation service — message/context validation, LLM dispatch, audit logging, context management |
| `backend/src/__tests__/conversation.test.js` | 43 focused tests for conversational AI (greetings, data questions, follow-ups, ambiguity, validation, tool allowlist, provider fallback, regression) |
| `docs/stage-10c-2b-report.md` | This report |

### Existing Files Modified

| File | Change |
|------|--------|
| `backend/src/routes/agent.js` | Added `POST /agent/chat` endpoint; updated file header to reflect new endpoint |
| `frontend/src/components/ModulePage.jsx` | Switched from `POST /agent/runs` to `POST /agent/chat`; sends conversation context; displays provider badge (Mock AI / Live LLM) |
| `backend/.env.example` | Documented new conversational AI env vars (OPENAI_API_KEY, AI_API_KEY, AI_API_BASE_URL, AI_MODEL) |

### Files NOT Changed (Preserved)

- No database schema changes, no migrations, no new DB tables
- `backend/src/services/coordinator.js` — unchanged (existing /agent/runs endpoint still works)
- `backend/src/services/inventoryAgent.js` — unchanged
- `backend/src/app.js` — unchanged (new route is within existing agent router)
- `frontend/src/components/ChatInput.jsx` — unchanged (voice input, file selection, styling preserved)
- `backend/package.json` — no new dependencies added

---

## Conversational Flow Implemented

### Architecture

```
User message + context (request body)
    ↓
POST /api/businesses/:businessId/agent/chat
    ↓
[authenticateToken] → [requireBusinessAccess] → req.businessId (verified)
    ↓
handleConversation({ businessId, userId, message, context })
    ↓
validateMessage() → validateContext() → generateResponse()
    ↓
┌─────────────────┐
│ LLM Provider    │
│                 │
│ OPENAI_API_KEY  │──→ liveLLM() → fetch to OpenAI API
│ or AI_API_KEY   │      (falls back to mockLLM on failure)
│ set?            │
│                 │
│ Neither set?   │──→ mockLLM() → deterministic responses
└─────────────────┘
    ↓
Tool execution (server-side only, businessId from auth)
    ↓
Audit log → audit_logs table
    ↓
Response: { reply, context, provider, is_live, tool_calls, conversation_id }
```

### Capabilities

1. **Greetings**: Detects "hello", "hi", "hey", "good morning/afternoon/evening" → responds with a friendly greeting listing available capabilities.

2. **Help/Capabilities**: Detects "help", "what can you do" → lists all available question types.

3. **Data-backed Questions**: Maps natural language to server-side tools:
   - "show low stock" → `get_low_stock` tool
   - "inventory summary" → `get_inventory_summary` tool
   - "task overview" → `get_task_overview` tool
   - "team workload" → `get_team_workload` tool
   - "financial overview" → `get_financial_overview` tool
   - "customer summary" → `get_customer_summary` tool
   - "marketing overview" → `get_marketing_overview` tool
   - "find product [name]" → `search_products` tool (with search term extraction)

4. **Follow-up Questions**: Detects "what about", "how about", "also", "too" → uses conversation context to infer the topic and provides updated data.

5. **Clarification Requests**: Very short or vague messages → asks user to be more specific.

6. **Fallback Suggestions**: Unrecognized input → offers a list of available capabilities.

### Security Measures

- **businessId**: Derived from `req.businessId` (set by `requireBusinessAccess` middleware from URL param + DB membership check) — never from request body
- **Tool allowlist**: Only 8 read-only tools can be executed; no write/delete/SQL execution tools
- **Tool arg validation**: Arguments JSON capped to 2000 chars
- **Message validation**: 1–1000 chars, must be a non-empty string
- **Context validation**: Max 20 messages, max 20000 total chars, only `user`/`assistant` roles allowed, client-supplied tool results never trusted as facts
- **Provider isolation**: Mock responses are clearly labelled `[Mock LLM]` — never presented as live AI
- **Audit logging**: Every conversation message logged to `audit_logs` table with provider, tool calls, and metadata

---

## Test/Build Results

### Backend Tests

**Command:** `cd backend && node node_modules/vitest/vitest.mjs run`

**Result:** 7 test files, 347 tests, **all 347 passed** (0 failures)

```
Test Files  7 passed (7)
     Tests  347 passed (347)
  Duration  15.81s
```

Breakdown:
- `auth.test.js` — 23 tests ✓
- `financials.test.js` — 44 tests ✓
- `inventory.test.js` — 55 tests ✓
- `marketing.test.js` — 94 tests ✓
- `tasks.test.js` — 70 tests ✓
- `security.test.js` — 18 tests ✓
- `conversation.test.js` — 43 tests ✓ (new)

### Frontend Production Build

**Command:** `cd frontend && node -e "import('vite').then(v => v.build())"`

**Result:** Build succeeded in 2.13s

```
✓ 67 modules transformed.
dist/index.html                   1.20 kB │ gzip:  0.67 kB
dist/assets/index-WcfBvObp.css   44.70 kB │ gzip:  7.45 kB
dist/assets/index-i6Ts8v7j.js   284.97 kB │ gzip: 81.16 kB
✓ built in 2.13s
```

---

## Provider Configuration Requirements

### Mock Provider (default — no configuration needed)

When neither `OPENAI_API_KEY` nor `AI_API_KEY` is set in `backend/.env`, the system uses the mock provider. All responses are clearly labelled `[Mock LLM]` and are deterministic. No external API calls are made.

### Live LLM Provider

To enable a live LLM provider, add one of these to `backend/.env`:

```env
# Option 1: OpenAI-compatible API
OPENAI_API_KEY=sk-your-real-api-key

# Option 2: Generic AI key (same detection as marketingGen.js)
AI_API_KEY=your-key

# Optional configuration (defaults shown):
AI_API_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

When a key is set:
- The system calls the OpenAI Chat Completions API
- If the live call fails (network, auth, rate limit), it falls back to mock with a `[LLM fallback]` prefix
- The frontend displays a "Live LLM" badge instead of "Mock AI"

---

## Live LLM Call Verification

**A live LLM call was NOT verified.** No API credentials are configured in the environment. The system is currently operating with the mock provider.

The `liveLLM()` function in `llmProvider.js` is a fully implemented integration that would call `POST {AI_API_BASE_URL}/chat/completions` with a Bearer token. However, since no real API key was provided, this code path was only exercised by the provider-failure-fallback test (which sets a fake key, expects the live call to fail, and verifies the mock fallback works correctly).

The test output confirms:
```
[LLM] Live provider failed, falling back to mock: LLM API error (401): 
Incorrect API key provided: sk-inval***********test.
```

This is expected behavior — the system gracefully degraded to the mock provider.

---

## Remaining Blockers

1. **No live LLM credentials configured**: The mock provider handles greetings, data questions, follow-ups, and suggestions, but does not generate free-form natural language. A live LLM would provide more flexible and natural responses. **To resolve**: Set `OPENAI_API_KEY` or `AI_API_KEY` in `backend/.env`.

2. **No tool-calling support in liveLLM()**: The `liveLLM()` function sends the message to the LLM API but does not currently implement function-calling / tool-use protocol. The mock provider handles tool dispatch internally. When upgrading to a live LLM with tool calling, the `liveLLM()` function would need to be extended to:
   - Include tool definitions in the API request (OpenAI function calling format)
   - Parse the LLM's tool-call response
   - Execute tools server-side via `executeTool()`
   - Send tool results back to the LLM for a final response
   
   This is a planned enhancement, not a bug — the mock provider demonstrates the full flow.

3. **Context not persisted**: Conversation context is sent in the request body and not stored server-side (by design — "without adding database tables or migrations"). Context is lost when the page is refreshed. To persist context, a `conversations` table would be needed in a future phase.

---

## Summary

Stage 2B is implemented. The conversational AI layer:
- Handles greetings, follow-ups, clarifications, and data-backed questions
- Uses a mock provider (no live LLM credentials configured)
- Reuses existing coordinator tool patterns as a server-side tool allowlist
- Enforces business isolation via authenticated businessId
- Preserves all existing UI, styling, voice input, and file selection
- Passes all 347 backend tests (including 43 new conversation tests)
- Builds cleanly for production
- No schema changes, no destructive operations, no new dependencies

Stopping for review as instructed.
