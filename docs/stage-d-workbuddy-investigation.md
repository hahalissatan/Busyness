# Stage D — WorkBuddy Runtime Integration Investigation

**Investigator's report on whether the Busyness backend can invoke WorkBuddy
as an external LLM/agent runtime.**

## 1. Investigation Method

Searched for any of:
- Public HTTP API
- CLI binary
- SDK / npm package
- Message protocol / IPC
- Connector / credential that bridges WorkBuddy → external app
- Environment variables or configuration files exposing WorkBuddy endpoints

Also read all available MCP tool manifests and connector registry files.

## 2. What WorkBuddy Is

WorkBuddy (installed at `C:\Users\eddie\AppData\Local\Programs\WorkBuddyAI\`)
is an **Electron desktop application** — `WorkBuddyAI.exe`. It is an AI
assistant for the user inside the desktop app. Its runtime model:

| Layer | Type |
|------|------|
| Process | Electron desktop app (not a server) |
| Storage | Local SQLite (`~/.workbuddy-ai/workbuddy.db`) + JSON files |
| Skills | Bundled in the app, callable inside the assistant |
| MCP tools | Internal to the assistant, invoked by the model loop |
| Connectors | Plugins that connect WorkBuddy → third-party SaaS |

## 3. What I Searched For and Found

| Probe | Result |
|------|--------|
| `where workbench` (PATH CLI) | **NOT FOUND** — no CLI binary |
| `~/.workbuddy-ai/mcp.json` | **DOES NOT EXIST** — no MCP server config |
| `~/.workbuddy-ai/connectors/enterprise-registry.json` | `entries: []` — empty |
| `~/.workbuddy-ai/connectors/<user>/connector-states.json` | `connectors: {}` — empty |
| Local HTTP ports from WorkBuddy | Port 39099 only — tencent-docs-engine (Doc editing, NOT agent API) |
| SDK in marketplace | None — only third-party SaaS connectors (DingTalk, Feishu, Notion, etc.) |
| Environment variable pointing to a client | None found |

## 4. What MCP Tools Are Actually Exposed

Three MCP tool groups registered (per `~/.workbuddy-ai/mcp-tool-list.json`):

### Group 1 — Canvas/Multimodal (`d1a4d6a3...`)
- `miora_write_canvas` — create moodboards
- `miora_open_canvas` — open canvas in side panel
- `miora_text_to_image` — generate image (requires `connect_cloud_service` first)
- `miora_edit_image`, `miora_text_to_video`, `miora_frame_to_video`, `miora_reference_to_video`, `miora_query_task`

**All require `connect_cloud_service` first to obtain a `clientTempToken`** —
the model loop runs INSIDE WorkBuddy and uses these as its own internal
tools. There is no documented way to invoke them from an external process.

### Group 2 — Excel (`99c9e368...`)
- `resolve_local_excel`, `get_cell_ranges`, `set_cell_range`, `read_table`,
  `run_command`, `search_data`, `calculate_*`, `fill_formula`

These are Excel editing tools for the WorkBuddy assistant, opened via the
editor SDK. They operate on local files opened by the user. **Not a backend API.**

### Group 3 — WeChat Pay (`2e24b0b9...`)
- `weixinpay_register`, `weixinpay_feedback`, `weixinpay_retry_pay`, `weixinpay_pay`

Payment integration tools. **Not relevant to business data queries.**

## 5. What Is NOT Exposed

- ❌ HTTP API for executing agent goals from external processes
- ❌ CLI binary (`workbuddy`, `wbagent`, etc.)
- ❌ Node.js / Python SDK for embedding
- ❌ MCP server config (`mcp.json`) that would let WorkBuddy run as a server
- ❌ Authentication tokens, API keys, or webhook secrets for external callers
- ❌ Any "business API" tool (no `run_goal`, no `query_business`, no `agent_chat`)

## 6. The Only Local HTTP Server WorkBuddy Runs

Port 39099 — `tencent-docs-engine`. Its purpose is serving Tencent Docs
editing operations locally:

```
$ curl http://127.0.0.1:39099/api/health
{"error":"Unknown endpoint: /localapi/health","ok":false}
```

The engine responds to `/localapi/*` paths only, not arbitrary agent goals.

## 7. Conclusion — No External Invocation Path Exists

**WorkBuddy cannot be invoked from the Busyness backend.** It is a desktop
assistant, not a hosted agent service. There is no documented public
interface for external applications to send a goal and receive execution
results.

Any future integration would require either:
1. WorkBuddy shipping an HTTP API, CLI, or SDK that does not currently exist
2. Running the Busyness coordinator INSIDE the WorkBuddy assistant (as a
   skill the user invokes manually) — which is the inverse direction
3. A user-mediated workflow (the user pastes query results between the two apps)

## 8. Implications for Busyness

| Path | Status |
|------|--------|
| Replace coordinator with WorkBuddy LLM call | ❌ Not possible — no WorkBuddy API |
| Have WorkBuddy invoke Busyness coordinator | 🟡 Possible only if the user does it manually inside WorkBuddy's chat — not an automated runtime path |
| Run both in the same Electron process | ❌ WorkBuddy is closed-source; we can't embed our backend in it |
| Use WorkBuddy's MCP tools from our backend | ❌ MCP tools require running INSIDE the WorkBuddy model loop |
| Current rule-based coordinator | ✅ Works, ships today, no external dependency |

## 9. Recommended Next Step

**Do NOT block on WorkBuddy integration.** The current rule-based
coordinator:

- Executes real queries against real business data
- Returns accurate, non-fabricated answers
- Is scoped to the authenticated business
- Has full audit trail
- Costs zero external API credits
- Passes 88/88 + 53/53 verification tests

If the product later needs an LLM-powered coordinator (natural-language
flexibility, multi-step reasoning, web search, etc.), the right providers
to evaluate are:

| Provider | Type | Notes |
|----------|------|-------|
| OpenAI | Hosted HTTP API | Requires API key, per-token billing |
| Anthropic Claude | Hosted HTTP API | Requires API key, per-token billing |
| Google Gemini | Hosted HTTP API | Requires API key, per-token billing |
| Local Ollama / LM Studio | Self-hosted HTTP | Free, no external dependency, lower capability |
| DeepSeek / Moonshot / Qwen | Hosted HTTP API | Often cheaper, available in China |

**WorkBuddy is NOT in this list** because it does not currently expose
the required interface.

## 10. If/When WorkBuddy Does Ship an API

A minimal integration design would look like:

```
┌─────────────────────┐         ┌─────────────────────┐
│  Busyness Backend   │         │   WorkBuddy API     │
│  (Node.js)          │         │   (Hypothetical)    │
│                     │  HTTPS  │                     │
│  /agent/runs ──────▶│ ──────▶ │  POST /v1/goals     │
│                     │ Bearer  │  Authorization:     │
│                     │  token  │   Bearer <api_key>  │
│  Intent router ────▶│         │  Returns:           │
│  (only forwards     │         │  { run_id, status,  │
│   to WorkBuddy if   │ ◀────── │    steps, report }  │
│   LLM is enabled)   │         │                     │
└─────────────────────┘         └─────────────────────┘
```

Required artifacts from WorkBuddy when/if it ships:
1. Public HTTPS endpoint with TLS
2. Bearer-token authentication
3. Goal submission API (`POST /v1/goals`)
4. Status query API (`GET /v1/runs/:run_id`)
5. Documented rate limits and per-key quotas
6. SDK or OpenAPI spec for at least one language

Until all six are present and verified by an end-to-end test, we should
NOT route live traffic to a "WorkBuddy integration" endpoint.

## 11. Files Changed in This Stage

None. No code was modified. This stage is purely investigative.

The server-side coordinator and frontend chat interface remain unchanged
and continue to pass all verification tests (53 smoke + 88 Stage A + 36 Stage C).