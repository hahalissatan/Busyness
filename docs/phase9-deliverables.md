# Financial AI Agent — Phase 9 Deliverables Summary

## 1. Existing Architecture Discovered

### Backend
- **Framework**: Express.js (v4.21) with ES modules (`"type": "module"`)
- **Database**: PostgreSQL via raw `pg` driver (no ORM, no Supabase) — all queries are parameterized SQL
- **Authentication**: JWT-based via `authenticateToken` middleware → `requireBusinessAccess` middleware (verifies business membership in DB)
- **Validation**: Zod schemas for request body validation
- **Transactional integrity**: `withTransaction()` helper wrapping BEGIN/COMMIT/ROLLBACK
- **Security**: Helmet (headers), CORS allowlist, rate limiting (general + auth-specific), no stack traces in errors

### Database Schema (key tables)
- `invoices`: `business_id`, `customer_id`, `invoice_number` (UNIQUE per business), `status`, `issue_date`, `due_date`, `subtotal`, `tax_amount`, `discount_amount`, `total`, `notes` — CHECK constraints on status, `due_date >= issue_date`
- `invoice_items`: `invoice_id`, `description`, `quantity` (>0), `unit_price` (>=0), `tax_rate` (0-100), `discount_amount`, `line_total` (SQL-calculated), `sort_order`
- `customers`: `business_id`, `name`, `email`, `phone`, `address`
- `payments`: `UNIQUE(business_id, idempotency_key)` for payment idempotency

### Frontend
- React + Vite, shared `ModulePage.jsx` chat component used across all modules (Inventory, Tasks, Financial, Marketing)
- `useNavigate` for routing from chat responses to invoice pages

### Existing AI Infrastructure
- `POST /api/businesses/:businessId/agent/chat` endpoint in `routes/agent.js`
- `conversation.js` service orchestrating chat flow
- `llmProvider.js` with mock LLM + live LLM (OpenAI function-calling) support
- Server-side tool allowlist pattern (`TOOL_ALLOWLIST`) with `execute(businessId, args, userId)` functions
- 7 read-only tools already existed (inventory, tasks, financials, customers, marketing summaries)

---

## 2. Files Created or Modified

### New Files
| File | Purpose |
|------|---------|
| `backend/src/services/invoiceAgent.js` | Secure invoice creation handler — customer resolution, transactional creation, idempotency, verification |
| `backend/src/__tests__/invoiceAgent.test.js` | 32 tests covering all 12 required scenarios + additional coverage |

### Modified Files
| File | Changes |
|------|---------|
| `backend/src/services/llmProvider.js` | Added 5 new tools to allowlist (`search_customers`, `create_invoice`, `list_invoices`, `get_invoice`, `check_existing_invoices`). Added natural-language intent detection (`detectInvoiceCreation`, `extractCustomerName`, `extractAmount`, `extractDescription`). Added `formatInvoiceConfirmation()` with date formatting. Updated `executeTool` to pass `userId` for write tools. Updated `liveLLM` to send parameter schemas for OpenAI function-calling. Reordered invoice question checks before creation detection. |
| `backend/src/services/conversation.js` | Passes `userId` through to `generateResponse` |
| `backend/src/routes/agent.js` | Updated comments to reflect write tool support |
| `backend/src/__tests__/conversation.test.js` | Updated tool allowlist test to reflect `create_invoice` is intentionally allowed |
| `frontend/src/components/ModulePage.jsx` | Added `useNavigate`, store `tool_calls`/`invoice_created`/`invoice_number`, show "Open Invoices" button on invoice creation |

---

## 3. Database Migrations or Policy Changes

**No migrations required.** The implementation reuses the existing `invoices`, `invoice_items`, and `customers` tables as-is.

- **Idempotency approach**: Idempotency keys are stored in the `notes` field of invoices as `[idem:KEY]` markers, avoiding any schema migration. The `checkIdempotency()` function searches for prior invoices with matching markers.
- **No policy changes**: Row-level security is enforced through the existing `requireBusinessAccess` middleware (business_id from URL, verified against `business_memberships` table).

---

## 4. AI Tool/Function Definitions

### Read-Only Tools
| Tool | Description | Parameters |
|------|-------------|------------|
| `search_customers` | Search customers by name/email/phone | `search_term: string` (required) |
| `list_invoices` | List recent invoices, optional status filter | `status: string?`, `limit: number?` |
| `get_invoice` | Get full invoice details by ID | `invoice_id: string` (required) |
| `check_existing_invoices` | Check if customer has existing invoices | `customer_name: string` (required) |

### Write Tool
| Tool | Description | Parameters | Security |
|------|-------------|------------|----------|
| `create_invoice` | Create a draft invoice for an existing customer | `customer_name: string`, `amount: number`, `description: string?`, `idempotency_key: string?` | `writable: true` — requires `userId` from JWT |

### Pre-Existing Read-Only Tools (unchanged)
`get_low_stock`, `get_inventory_summary`, `get_task_overview`, `get_team_workload`, `get_financial_overview`, `get_customer_summary`, `get_marketing_overview`, `search_products`

---

## 5. Server-Side Invoice Execution Workflow

```
User message: "Create an invoice for Cafe Maju for RM500"
    │
    ▼
POST /agent/chat (authenticated, businessId from URL, userId from JWT)
    │
    ▼
conversation.js → generateResponse({ message, context, businessId, userId })
    │
    ▼
llmProvider.js → mockLLM or liveLLM
    │
    ├─ detectInvoiceCreation() — regex intent detection
    ├─ extractCustomerName()   — parse "Cafe Maju" from message
    ├─ extractAmount()          — parse "RM500" → 500.00
    ├─ extractDescription()     — optional
    │
    ▼
executeTool("create_invoice", businessId, args, userId)
    │  (server-side allowlist, args < 2000 chars, userId required for write)
    ▼
invoiceAgent.js → createInvoiceFromChat({ businessId, userId, args })
    │
    1. validateCreateArgs()     — validate customer_name, amount (0.01–99,999,999.99)
    2. checkIdempotency()       — search notes for [idem:KEY], return existing if found
    3. resolveCustomer()        — ILIKE search, return if 1 match, ask if ambiguous
    4. generateInvoiceNumber()  — INV-YYYY-NNN (MAX+1)
    5. Calculate: subtotal = total / 1.06, tax = total - subtotal
    6. withTransaction():
       a. INSERT invoice (business_id, customer_id, invoice_number, 'draft', dates, totals, notes with [idem:KEY])
       b. INSERT invoice_item (description, qty=1, unit_price=subtotal, tax_rate=6%, SQL-calculated line_total)
       c. UPDATE invoices SET totals = SUM(line_items) — authoritative recalculation
       d. Re-fetch updated invoice
    7. verifyInvoice()           — re-fetch from DB to confirm persistence
    8. Return { status, message, invoice, invoice_id, is_idempotent }
    │
    ▼
formatInvoiceConfirmation(inv) — verified fields only:
    Customer, Invoice number, Issue/Due dates (YYYY-MM-DD),
    Subtotal, Tax (6%), Total, Status, Line items
    │
    ▼
Response: { reply, context, provider, is_live, tool_calls, conversation_id }
    │
    ▼
Frontend: ModulePage.jsx
    ├─ Display reply text
    ├─ If invoice_created: show "Open Invoices" button → /financial/invoices
    └─ Store tool_calls for audit
```

---

## 6. Environment Variables

No new environment variables were introduced. The implementation uses the existing configuration:

| Variable | Purpose | Required |
|----------|---------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | Yes |
| `JWT_EXPIRES_IN` | Token lifetime (default: 7d) | No |
| `OPENAI_API_KEY` | Enable live LLM (OpenAI) | Optional — mock LLM used if not set |
| `AI_API_KEY` | Alternative LLM API key | Optional |
| `AI_API_BASE_URL` | Alternative LLM base URL | Optional |
| `AI_MODEL` | LLM model name (default: gpt-4o-mini) | Optional |
| `PORT` | Server port (default: 3001) | No |
| `CORS_ORIGIN` | Allowed origins for CORS | No (localhost auto-allowed in dev) |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window | No |
| `RATE_LIMIT_MAX` | Max requests per window | No |

---

## 7. Tests Performed and Results

### Automated Test Suite
```
Test Files  8 passed (8)
     Tests  379 passed (379)
  Duration  ~17s
```

**New tests (32 in `invoiceAgent.test.js`):**

| # | Scenario | Result |
|---|----------|--------|
| 1 | Clear invoice creation with all fields | ✅ Pass |
| 2 | Missing amount → asks "How much?" | ✅ Pass |
| 3 | Unknown customer → "No customer found" | ✅ Pass |
| 4 | Ambiguous customer match → lists options | ✅ Pass |
| 5 | Unauthorized user (no userId) → rejected | ✅ Pass |
| 6 | DB insertion failure → graceful error | ✅ Pass |
| 7 | Idempotency — retry returns existing invoice | ✅ Pass |
| 8 | Duplicate prevention — `is_idempotent: true` | ✅ Pass |
| 9 | Follow-up reference to previous invoice | ✅ Pass |
| 10 | Instruction question → no invoice created | ✅ Pass |
| 11 | "Prepare but don't save" → preview only | ✅ Pass |
| 12 | Verified persisted record (re-fetched) | ✅ Pass |
| + | Customer search, resolve, list, get, check existing | ✅ Pass |
| + | Invoice number generation (sequential) | ✅ Pass |
| + | Mock LLM NL understanding (7 expression variants) | ✅ Pass |
| + | Tool definitions & parameter schemas | ✅ Pass |
| + | API auth required for chat endpoint | ✅ Pass |

### Live End-to-End Tests

| Test | Input | Result |
|------|-------|--------|
| Invoice creation | "Create an invoice for Mini Mart Sejahtera for RM750" | ✅ INV-2026-039 created, subtotal RM707.55, tax RM42.45, total RM750.00, dates formatted |
| Missing amount | "Add an invoice for Mini Mart Sejahtera" | ✅ "How much should I invoice them for?" |
| Instruction question | "How do I create an invoice?" | ✅ Instructions only, 0 tool_calls, no invoice created |
| "Did we already invoice" | "Did we already invoice Cafe Maju?" | ✅ Listed 10 existing invoices, no new invoice created |
| "Show recent invoices" | "Show recent invoices" | ✅ Listed 10 invoices with INV-2026-039 at top |

---

## 8. Deployment Steps

1. **Prerequisites**: PostgreSQL database running, `busyness` database created, migrations applied (`npm run db:migrate`), seed data loaded (`npm run db:seed`)
2. **Configuration**: Copy `.env.example` to `.env`, set `DATABASE_URL`, `JWT_SECRET` (min 32 chars), optionally `OPENAI_API_KEY` for live LLM
3. **Install dependencies**: `npm install` (in `backend/`)
4. **Run migrations**: `npm run db:migrate`
5. **Seed database**: `npm run db:seed`
6. **Start server**: `npm start` (or `npm run dev` for watch mode)
7. **Frontend**: `cd frontend && npm install && npm run dev` (Vite dev server on :5173)
8. **Verify**: `curl http://localhost:3001/api/health` → `{"status":"ok"}`
9. **Test chat**: Use the chatbox in any module page (Inventory, Tasks, Financial, Marketing)

---

## 9. Remaining Limitations

| Limitation | Details |
|------------|---------|
| **Mock LLM** | Without `OPENAI_API_KEY`, the mock LLM uses regex-based intent detection. It handles common phrasings but may miss unusual sentence structures. With a live LLM configured, full natural-language understanding is available via OpenAI function-calling. |
| **Single line item** | The `create_invoice` tool creates invoices with a single line item. Multi-line invoices would require extending the tool's parameter schema to accept an array of items. |
| **Tax rate is fixed** | The 6% Malaysian SST rate is hardcoded as `DEFAULT_TAX_RATE`. It could be made configurable per-business in the future. |
| **Customer creation** | If a customer doesn't exist, the AI asks the user to create the customer first (via the Customers page). The AI cannot create customers via chat — this is intentional for security. |
| **Invoice modification** | The AI can create invoices but cannot modify or delete them. This is by design — modifications must be done through the invoice detail page for audit trail integrity. |
| **Idempotency via notes field** | Idempotency keys are stored in the `notes` field as text markers. A dedicated `idempotency_key` column would be cleaner but requires a migration. |
| **Currency** | All amounts are in RM (Malaysian Ringgit). Multi-currency support would require a currency field on invoices. |

---

## Summary

The Financial AI Agent is fully operational across all module chatboxes (Inventory, Tasks, Financial, Marketing — all share the same `ModulePage.jsx` chat component). Users can create invoices by typing natural-language requests like "Create an invoice for Cafe Maju for RM500", and the AI will:

1. Understand the intent (not confuse questions with actions)
2. Resolve the customer against real DB records
3. Create the invoice transactionally with SQL-calculated totals
4. Verify the persisted record by re-fetching it
5. Display only verified data (customer name, invoice number, dates, amounts, status, line items)
6. Show an "Open Invoices" button for direct navigation

All 379 tests pass. Live end-to-end tests confirm correct behavior for invoice creation, missing-amount detection, instruction questions, existing-invoice checks, and invoice listing.
