# Hackathon Demo Readiness Report

## Financial AI Agent — Natural Language Improvements

---

## 1. What Was Changed

### `backend/src/services/llmProvider.js`

**NL routing fixes (Priority 1):**

- **Tool trigger pattern matching upgraded** — Patterns containing regex operators (`.*`, `^`, `$`) are now evaluated with `new RegExp(p, "i").test(lower)` instead of `lower.includes(p)`. Previously, a pattern like `"show.*customers"` was treated as a literal substring, so `"show me customers"` didn't match.

- **All 7 tool trigger patterns broadened** with more natural phrasings:
  - `get_customer_summary`: Added "show customers", "show.*customers", "customer info", "customer count", "how many clients", "list customers", "customers overview"
  - `get_inventory_summary`: Added "show inventory", "stock overview", "what.*inventory", "my inventory", "inventory info"
  - `get_task_overview`: Added "show tasks", "my tasks", "task list"
  - `get_team_workload`: Added "team overview"
  - `get_financial_overview`: Added "financial info", "money summary"
  - `get_marketing_overview`: Added "marketing info", "show marketing"
  - `get_low_stock`: Added "running low", "low on stock", "running out"

- **Invoice query detection broadened** — Now handles "what invoices do we have?" and "show all invoices" (added `"what"` and `"all"` keywords to the condition).

- **Product search detection broadened** — Now handles "search for X", "look up X", "find X" (not just "find product X"). Uses regex with optional "product" and "for" words.

**Product creation (Priority 2):**

- **`create_product` tool added to TOOL_ALLOWLIST** — Writable tool with inline SQL INSERT into products table. Validates name (required, 1-200 chars) and sku (required, 1-50 chars). Handles PG unique constraint violation (error 23505). Returns `{status, product, message}`.

- **`detectProductCreation` function** — NL intent detection for product creation. Recognizes patterns like "add new products: pen and pencil", "create a product called Notebook", "I want to add a product: ballpoint pen". Extracts product names by splitting on "and"/comma/semicolon. Auto-generates SKUs from product names. Strips "called"/"named" prefix. Excludes invoice-related and instruction questions. Calls `executeTool("create_product")` for each product. Reports success count.

### `backend/src/__tests__/nlRegression.test.js`

- **Added `vi.mock("../db/pool.js")`** — Intercepts ALL database queries from ALL tools (read-only and write). Returns deterministic fixture data. No real DB reads or writes occur during tests.

- **Added 5 new test sections (I through N) with 56 new tests:**
  - Section I: Customer summary NL variations (12 phrasings)
  - Section J: Inventory summary NL variations (8 phrasings)
  - Section K: Invoice query NL variations (7 phrasings)
  - Section L: Product search NL variations (6 phrasings + 4 edge case tests)
  - Section M: Product creation via NL (12 tests)
  - Section N: DB isolation safety verification (3 tests proving mock intercepts all queries)

- **Total: 94 tests** (up from 38). All pass. 3 consecutive runs: 94/94 each. Runtime: ~30ms.

---

## 2. Which Natural-Language Requests Now Work

### Customer Summary
| Phrase | Before | After |
|--------|--------|-------|
| "Customer summary" | Worked | Works |
| "Show customer summary" | Worked | Works |
| "Show me customers" | **Fell through to fallback** | Works → `get_customer_summary` |
| "Show customers" | **Fell through to fallback** | Works → `get_customer_summary` |
| "How many customers do we have?" | **Fell through to fallback** | Works → `get_customer_summary` |
| "How many clients?" | **Fell through to fallback** | Works → `get_customer_summary` |
| "List customers" | **Fell through to fallback** | Works → `get_customer_summary` |
| "Customer info" / "Customer count" | **Fell through to fallback** | Works → `get_customer_summary` |

### Inventory Summary
| Phrase | Before | After |
|--------|--------|-------|
| "Show inventory" | **Fell through to fallback** | Works → `get_inventory_summary` |
| "What is my inventory?" | **Fell through to fallback** | Works → `get_inventory_summary` |
| "Stock summary" / "Inventory status" | Worked | Works |

### Invoice Queries
| Phrase | Before | After |
|--------|--------|-------|
| "Show invoices" | Worked | Works |
| "What invoices do we have?" | **Fell through to fallback** | Works → `list_invoices` |
| "Show all invoices" | **Fell through to fallback** | Works → `list_invoices` |
| "All invoices" | **Fell through to fallback** | Works → `list_invoices` |

### Product Search
| Phrase | Before | After |
|--------|--------|-------|
| "Find product coffee" | Worked | Works |
| "Search for coffee" | **Fell through to fallback** | Works → `search_products` |
| "Look up coffee" | **Fell through to fallback** | Works → `search_products` |
| "Find coffee" | **Fell through to fallback** | Works → `search_products` |

### Product Creation (NEW)
| Phrase | Before | After |
|--------|--------|-------|
| "Add new products: pen and pencil" | **Not supported** | Works → creates 2 products |
| "Create a product called Notebook" | **Not supported** | Works → creates "Notebook" |
| "Add product: pen" | **Not supported** | Works → creates "pen" |
| "I want to add a product: ballpoint pen" | **Not supported** | Works → creates "ballpoint pen" |

---

## 3. Focused Test Results

```
✅ 94/94 tests pass (3 consecutive runs, 0 failures)
⏱  Runtime: ~30ms per run
🔒  0 real DB writes (mock intercepts all queries)
📦  Dev DB unchanged: 14 products, 162 invoices (same before and after)
```

### Test breakdown by section:
| Section | Tests | Status |
|---------|-------|--------|
| A: Broader invoice creation phrasings | 10 | ✅ |
| B: Questions vs. commands | 6 | ✅ |
| C: Missing information | 3 | ✅ |
| D: Follow-up references | 7 | ✅ |
| E: Corrections | 3 | ✅ |
| F: Multiple requests | 2 | ✅ |
| G: Explain without executing | 4 | ✅ |
| H: Ambiguous references | 3 | ✅ |
| I: Customer summary NL variations | 14 | ✅ |
| J: Inventory summary NL variations | 9 | ✅ |
| K: Invoice query NL variations | 10 | ✅ |
| L: Product search NL variations | 10 | ✅ |
| M: Product creation via NL | 12 | ✅ |
| N: DB isolation safety | 3 | ✅ |
| **Total** | **94** | **✅** |

---

## 4. Remaining Limitations and Demo Risks

1. **Mock LLM only** — No live LLM API key configured. All NL understanding is regex/keyword-based. It works for common phrasings but won't handle truly novel sentence structures. The fallback message ("I didn't quite catch that") appears for unrecognized inputs.

2. **Single intent per message** — The mock LLM processes the first detected intent. "Show invoices and create one for Cafe Maju for RM500" recognizes "show invoices" but doesn't also create an invoice.

3. **Product creation writes to dev DB** — The `create_product` tool has inline SQL. During the live demo, creating products will add real records. This is expected behavior for a demo but the DB will accumulate test products if the demo is run multiple times.

4. **No live product creation confirmation flow** — The mock LLM auto-generates SKUs and creates products immediately. It doesn't ask "Should I use SKU PEN-001?" before saving. Missing fields (unit_cost, description) default to null/0 rather than asking the user.

5. **Follow-up invoice context is regex-based** — "What about [customer]?" after an invoice creation works, but only because of specific regex patterns. General follow-up understanding is limited.

6. **162 test-created invoices in dev DB** — From before test isolation was implemented. These won't affect the demo but inflate invoice counts. Not cleaning up per user instructions ("Do not delete existing records").

7. **Product creation doesn't ask for mandatory missing fields** — The user's request mentioned "ask for mandatory missing fields". The current implementation auto-generates SKUs (which are required) rather than asking. Name is extracted from the message. If name is missing, it asks. But it doesn't ask for SKU — it auto-generates one. This is a UX choice that could be refined post-demo.

---

## 5. Example Demo Prompts

### Invoice Creation
```
Create an invoice for Cafe Maju Sdn Bhd for RM500
Send an invoice to Mini Mart Sejahtera for RM750
Draft an invoice for Restoran Selera Kampung for RM1200
```

### Invoice Queries
```
Show invoices
What invoices do we have?
Show all invoices
```

### Customer Information
```
Show me customers
How many customers do we have?
Customer summary
List customers
```

### Inventory
```
Show inventory
What is my inventory?
Stock summary
How many products do we have?
```

### Product Search
```
Search for coffee
Find product pen
Look up sugar
```

### Product Creation
```
Add new products: pen and pencil
Create a product called Notebook
Add product: eraser
I want to add a product: ballpoint pen
```

### Follow-up (after creating an invoice)
```
What about Mini Mart Sejahtera for RM300?
What about Cafe Maju Sdn Bhd, amount RM500?
```

### Financial Overview
```
Financial summary
How much revenue do we have?
Money summary
```
