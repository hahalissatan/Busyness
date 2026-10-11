# Real LLM Enablement — Implementation Report

## Summary

The `liveLLM()` function was **already fully implemented** in `backend/src/services/llmProvider.js`. It uses OpenAI-compatible structured function/tool calling with a multi-round loop. The `generateResponse()` entry point already routes to it when an API key is detected. **No architectural rebuild was needed.**

The only thing missing was the API key in `.env`. I made small polish changes to the system prompt and tool params so the LLM behaves more naturally.

---

## Files Changed (This Turn)

### 1. `backend/.env` (gitignored — not committed)
Added commented-out LLM provider configuration block:
```env
#OPENAI_API_KEY=
#AI_API_KEY=
#AI_API_BASE_URL=https://api.openai.com/v1
#AI_MODEL=gpt-4o-mini
```

### 2. `backend/src/services/llmProvider.js`
- **System prompt improved** (in `liveLLM` function): Added Malaysian SME context, RM currency formatting, clarifying-question guidelines ("NEVER invent or guess values"), follow-up context guidance, product creation SKU handling. Removed "$ formatting" instruction.
- **`create_invoice` params `required` fixed**: Changed from `["customer_name", "amount", "description"]` to `["customer_name"]`. This allows the LLM to call the tool with just the customer name — the tool itself will ask the user for the missing amount.
- **`create_product` params `required` fixed**: Changed from `["name", "sku"]` to `["name"]`. The LLM can call with just the product name — the tool will ask for the SKU.
- **`max_tokens` increased** from 500 to 1000 for more natural responses.

### 3. `backend/src/routes/agent.js`
- **Added `GET /agent/provider` endpoint**: Returns `{provider, isLive, note, model, baseUrl}` — lets you verify whether the agent is using a real LLM or the mock fallback. Does NOT expose API keys.

---

## Whether Real LLM Calls Are Enabled

**Not yet — you need to add an API key.** The code is ready. Currently:

```
Provider: mock
isLive: false
```

When you set an API key, it automatically switches to:

```
Provider: openai
isLive: true
```

---

## API Key / Configuration You Still Need to Provide

Add **ONE** of these to `backend/.env`:

### Option A: OpenAI (default)
```env
OPENAI_API_KEY=sk-your-openai-key-here
```
Uses `gpt-4o-mini` by default. No other config needed.

### Option B: Any OpenAI-compatible provider (Groq, OpenRouter, Together, etc.)
```env
AI_API_KEY=your-key-here
AI_API_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=llama-3.3-70b-versatile
```

After setting the key, **restart the backend** (`npm run dev`).

To verify it's working, call the provider status endpoint:
```
GET http://localhost:3001/api/businesses/11111111-1111-1111-1111-111111111111/agent/provider
```
(Requires authentication — log in first or use the demo session.)

---

## How It Works (Architecture Already Existed)

```
User message
    ↓
generateResponse() → getProviderInfo()
    ↓                     ↓
isLive=true           isLive=false
    ↓                     ↓
liveLLM()              mockLLM()
    ↓                     ↓
Send to OpenAI API     Regex/keyword patterns
with tool definitions  (deterministic fallback)
    ↓
LLM selects tool(s)
via function calling
    ↓
executeTool() runs
server-side (TOOL_ALLOWLIST)
    ↓
Tool results sent back
to LLM for natural-language
response generation
    ↓
Final reply with
provider: "openai"
```

**Key security properties preserved:**
- LLM never executes arbitrary SQL — it can only call tools in the server-side allowlist
- `businessId` comes from authenticated request context, never from LLM output
- `userId` comes from JWT, never from LLM output
- Write tools (`create_invoice`, `create_product`) require authenticated userId
- Tool arguments are validated server-side with size limits
- Mock fallback is clearly labelled `[Mock LLM]` / `[LLM fallback]`

---

## Test Results

```
✅ 94/94 nlRegression tests pass (mocked persistence, no DB writes)
✅ 43/43 conversation tests pass (includes live LLM fallback test)
Total: 137/137 pass
Runtime: ~2.8s
DB writes: 0 (all mocked)
```

---

## Three Example Natural-Language Requests to Manually Test

After adding an API key and restarting the backend, try these in the chatbox:

1. **"How many customers do we have and who are they?"**
   The LLM should call `get_customer_summary`, get the results, and respond in natural language with the count and names.

2. **"Create an invoice for Cafe Maju Sdn Bhd for RM500"**
   The LLM should call `create_invoice` with `customer_name: "Cafe Maju Sdn Bhd"` and `amount: 500`. If the customer exists, it creates the invoice and confirms with the invoice number.

3. **"What about Mini Mart Sejahtera?"** (as a follow-up after the invoice above)
   The LLM should use conversation context to understand "what about" refers to creating another invoice, then ask for the amount since it wasn't provided.

---

## Remaining Limitations

1. **No API key set yet** — Currently using mock LLM with regex patterns. You must add `OPENAI_API_KEY` (or `AI_API_KEY` + `AI_API_BASE_URL` + `AI_MODEL`) to `backend/.env` and restart the backend.

2. **Max 3 tool-call rounds** — If the LLM needs more than 3 back-and-forth tool calls to complete a request, it returns a fallback message. This is a safety limit to prevent infinite loops.

3. **30-second API timeout** — Each LLM API call has a 30-second timeout. Slow API responses will abort and fall back to mock.

4. **Context limited to last 10 messages** — Conversation history sent to the LLM is capped at the last 10 messages to control token costs.

5. **Mock fallback is regex-based** — If the live LLM fails (API error, timeout, rate limit), the system falls back to the mock LLM which uses hardcoded keyword patterns. Responses will be prefixed with `[LLM fallback]`.

6. **Product creation asks for SKU** — When the LLM calls `create_product` without a SKU, the tool returns `needs_clarification` asking for one. The LLM should then ask the user. This is by design (never invent values).

7. **No streaming** — Responses are returned as complete text, not streamed token-by-token. This is fine for a demo but feels less "ChatGPT-like" in latency.

8. **162 test-created invoices in dev DB** — From before test isolation was implemented. These exist but don't affect functionality. Not cleaned up per user instructions.
