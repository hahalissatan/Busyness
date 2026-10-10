# Phase 10C — Inventory Intelligence Improvements
## Stage 1: Inspect, Design, and Prioritise

> **Status:** Design only. No code, schema, configuration, or data has been modified.
> **Date:** 2026-10-11
> **Prerequisite:** Phase 10B Stage 4 acceptance (ACCEPT WITH LIMITATIONS)

---

## Table of Contents

1. [Verified Schema and Data Inventory](#1-verified-schema-and-data-inventory)
2. [Current Capabilities and Confirmed Gaps](#2-current-capabilities-and-confirmed-gaps)
3. [Capability-to-Data Feasibility Matrix](#3-capability-to-data-feasibility-matrix)
4. [Proposed Recommendation Rules and Formulas](#4-proposed-recommendation-rules-and-formulas)
5. [Prioritised Implementation Plan](#5-prioritised-implementation-plan)
6. [Test Plan with Expected Results](#6-test-plan-with-expected-results)
7. [Risks and Unresolved Questions](#7-risks-and-unresolved-questions)
8. [No-Change Confirmation](#8-no-change-confirmation)

---

## 1. Verified Schema and Data Inventory

### 1.1 Products Table (migration 003_create_inventory.sql)

| Field | Type | Constraints | Default | Agent-Relevant? |
|---|---|---|---|---|
| `id` | UUID PK | — | — | Identifier |
| `business_id` | UUID FK | NOT NULL | — | Business scoping |
| `name` | VARCHAR(255) | NOT NULL | — | Display, search |
| `sku` | VARCHAR(100) | Nullable, unique per business | — | Display, search |
| `description` | TEXT | Nullable | — | Search |
| `stock_quantity` | NUMERIC(10,2) | CHECK >= 0, trigger-protected | 0 | **Core metric** |
| `min_stock_threshold` | NUMERIC(10,2) | — | **0** | **Core metric** |
| `unit_cost` | NUMERIC(12,2) | — | **0** | Value calculation |
| `expiry_date` | DATE | Nullable | NULL | Expiry tracking |
| `supplier_id` | UUID FK | Nullable, FK to suppliers | NULL | Supplier linkage |
| `is_active` | BOOLEAN | — | true | Active filter |
| `created_at` | TIMESTAMPTZ | — | now() | Age analysis |
| `updated_at` | TIMESTAMPTZ | — | now() | Staleness check |

**Fields NOT present (confirmed):**
- ~~`max_stock_threshold`~~ — cannot detect overstock
- ~~`target_stock`~~ — cannot determine ideal stock level
- ~~`reorder_quantity`~~ — cannot suggest optimal order size
- ~~`reorder_point`~~ — `min_stock_threshold` serves this role
- ~~`lead_time`~~ — on suppliers table, not products
- ~~`category`~~ / ~~`tags`~~ — cannot group by category

### 1.2 Suppliers Table (migration 003_create_inventory.sql)

| Field | Type | Constraints | Default | Agent-Relevant? |
|---|---|---|---|---|
| `id` | UUID PK | — | — | Identifier |
| `business_id` | UUID FK | NOT NULL | — | Business scoping |
| `name` | VARCHAR(255) | NOT NULL | — | Display |
| `contact_name` | VARCHAR(255) | Nullable | NULL | Restocking contact |
| `email` | VARCHAR(255) | Nullable | NULL | Restocking contact |
| `phone` | VARCHAR(50) | Nullable | NULL | Restocking contact |
| `address` | TEXT | Nullable | NULL | Display |

**Fields NOT present (confirmed):**
- ~~`lead_time`~~ — cannot calculate reorder timing
- ~~`minimum_order_quantity`~~ — cannot determine if order meets supplier minimum
- ~~`pricing_terms`~~ — cannot access contract pricing
- ~~`preferred_supplier`~~ — no priority flag

### 1.3 Stock Movements Table (migration 003_create_inventory.sql)

| Field | Type | Constraints | Default | Agent-Relevant? |
|---|---|---|---|---|
| `id` | UUID PK | — | — | Identifier |
| `product_id` | UUID FK | NOT NULL | — | Product linkage |
| `business_id` | UUID FK | NOT NULL | — | Business scoping |
| `movement_type` | VARCHAR(20) | CHECK: purchase/sale/adjustment/return/transfer/writeoff | — | **Demand signal** |
| `quantity_change` | NUMERIC(10,2) | NOT NULL | — | **Quantity tracking** |
| `reason` | VARCHAR(500) | Nullable | NULL | Context |
| `reference_type` | VARCHAR(50) | Nullable | NULL | Source linkage |
| `reference_id` | UUID | Nullable | NULL | Source linkage |
| `created_at` | TIMESTAMPTZ | — | now() | **Temporal analysis** |

**Key properties:**
- Append-only — `prevent_update_delete()` trigger blocks all UPDATE/DELETE
- `apply_stock_movement()` trigger updates `products.stock_quantity` after INSERT
- `movement_type = 'sale'` has negative `quantity_change` — this is the **only demand signal** available

**Sign conventions (from inventory.js):**

| Type | Sign | Purpose |
|---|---|---|
| `purchase` | + | Stock in from supplier |
| `return` | + | Customer return |
| `sale` | - | Stock out to customer |
| `writeoff` | - | Damaged/expired |
| `adjustment` | ± | Manual correction |
| `transfer` | ± | Between locations |

### 1.4 Invoice Items Table (migration 002_create_financials.sql)

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | — |
| `invoice_id` | UUID FK | Links to invoice |
| `description` | VARCHAR(500) | **Free text — NOT linked to products** |
| `quantity` | NUMERIC(10,2) | — |
| `unit_price` | NUMERIC(12,2) | — |
| `tax_rate` | NUMERIC(5,2) | — |
| `discount_amount` | NUMERIC(12,2) | — |
| `line_total` | NUMERIC(12,2) | — |

**Critical finding:** `invoice_items` has NO `product_id` field. Invoice items are free-text descriptions, NOT linked to products. **Sales demand per product cannot be derived from invoice data.** The only demand signal is `stock_movements WHERE movement_type = 'sale'`.

### 1.5 Seed Data (seed.sql) — Baseline Reference

| Entity | Count | Notes |
|---|---|---|
| Products | 5 | Cooking Oil, Rice, Canned Tuna, Flour, Sugar |
| Suppliers | 2 | Global Foods Sdn Bhd, Premium Supplies Co |
| Stock movements | 10 | 5 purchase + 5 sale (1 per product) |
| Invoices | 5 | With line items (free text, not product-linked) |
| Payments | 3 | — |

**Key observation:** Seed data includes 'sale' type stock movements, confirming the demand signal pathway exists. However, only 1 sale per product is insufficient for meaningful velocity analysis.

### 1.6 Trigger Protections (migration 007_create_triggers.sql)

| Trigger | Protects | Behaviour |
|---|---|---|
| `prevent_update_delete()` | `stock_movements`, `audit_logs` | Blocks ALL UPDATE and DELETE operations |
| `protect_stock_quantity()` | `products.stock_quantity` | Blocks direct UPDATE unless session flag `app.stock_movement` is set |
| `apply_stock_movement()` | `products.stock_quantity` | AFTER INSERT on `stock_movements` → updates `stock_quantity` via session flag |

**Implication for design:** All new agent intents MUST be SELECT-only. No writes to any table. The agent cannot create stock movements, update products, or modify audit logs.

### 1.7 Inventory REST API (routes/inventory.js) — Existing Endpoints

| Endpoint | Purpose | Agent can call? |
|---|---|---|
| `GET /overview` | Summary stats (total products, value, low stock, near expiry) | N/A — agent uses its own SQL |
| `GET /low-stock` | Products at/below threshold with shortfall | N/A — agent has its own `low_stock` intent |
| `POST /products` | Create product | No — write operation |
| `GET /products` | List products (search, pagination) | N/A — agent uses its own SQL |
| `POST /stock-movements` | Record stock movement | No — write operation |

**Design note:** The agent executes SQL directly via `query()` from `pool.js`, NOT via REST API calls. This is the existing pattern — all 11 current intents use direct parameterized SQL queries.

---

## 2. Current Capabilities and Confirmed Gaps

### 2.1 Current Agent Intents (11 total)

#### Coordinator Intents (7) — from `coordinator.js`

| # | Intent ID | Agent Type | What It Does | Data Used |
|---|---|---|---|---|
| 1 | `low_stock` | inventory | Lists products where `stock_quantity <= min_stock_threshold` | products (name, sku, stock_quantity, min_stock_threshold, unit_cost) |
| 2 | `inventory_summary` | inventory | Counts total products, total value, low stock count, out of stock count | products (COUNT, SUM, FILTER) |
| 3 | `task_overview` | task_allocation | Task counts by status (pending, in_progress, completed, overdue) | tasks |
| 4 | `team_workload` | task_allocation | Per-member task assignments and capacity | employees + task_assignments + tasks |
| 5 | `financial_overview` | financial | Invoice/payment summary by status, revenue, outstanding | invoices |
| 6 | `customer_summary` | financial | Total customers, new this month | customers |
| 7 | `marketing_overview` | marketing | Marketing project/draft/pitch deck counts | marketing_projects, marketing_drafts, pitch_decks |

#### Inventory Specialist Agent Intents (4) — from `inventoryAgent.js`

| # | Intent ID | Agent Type | What It Does | Data Used |
|---|---|---|---|---|
| 8 | `product_search` | inventory | ILIKE search on name/sku/description | products (ILIKE, escaped wildcards) |
| 9 | `near_expiry` | inventory | Products expired or expiring within 7 days | products (expiry_date, to_char) |
| 10 | `stock_movement_history` | inventory | 20 most recent stock movements | stock_movements JOIN products |
| 11 | `inventory_by_supplier` | inventory | Stock value grouped by supplier | products LEFT JOIN suppliers, GROUP BY |

### 2.2 What the Current Agent CAN Do

- Identify products at/below `min_stock_threshold` (low stock alert)
- Summarise total inventory value and counts
- Search products by name, SKU, or description (with ILIKE wildcard safety)
- Identify expired and soon-to-expire products (7-day window)
- Show recent stock movement history (20 most recent)
- Group inventory by supplier with value totals
- Multi-intent queries (e.g., "low stock and near expiry")
- Business-scoped isolation (every query includes `WHERE business_id = $1`)
- Full audit trail (agent_runs, agent_run_steps, audit_logs)
- Read-only enforcement (no PUT/PATCH/DELETE on agent routes)
- Fallback response listing all 11 capabilities when no intent matches

### 2.3 What the Current Agent CANNOT Do (Confirmed Gaps)

| Gap | Reason | Impact |
|---|---|---|
| **No restocking recommendations** | `low_stock` lists products but doesn't suggest reorder quantities, supplier contact info, or estimated costs | User must manually determine what to order, from whom, and how much |
| **No stockout risk projection** | No demand velocity calculation (would need `stock_movements WHERE movement_type='sale'` aggregation over time) | User cannot anticipate which products will run out soon |
| **No fast/slow mover analysis** | No aggregation of sale movements by product over a time window | User cannot identify which products sell quickly vs. slowly |
| **No data quality alerts** | No detection of products with `min_stock_threshold=0`, missing supplier, `unit_cost=0` | User may not realise inventory data is incomplete |
| **No overstock detection** | No `max_stock_threshold` field in schema | Cannot be resolved without schema change (out of scope) |
| **No reorder timing** | No `lead_time` on suppliers table | Cannot be resolved without schema change (out of scope) |
| **No sales demand from invoices** | `invoice_items` has no `product_id` field | Cannot be resolved without schema change (out of scope) |
| **Limited explainability** | Steps have `evidence.source` and `_summary` but no `reasoning`, `caveats`, or `confidence` field | User gets data but not the "why" behind recommendations |
| **No inventory health score** | No composite metric combining stock levels, expiry, data quality | User gets individual alerts but no overall health picture |

### 2.4 Current Test Coverage Summary

| Test Suite | Tests | Coverage |
|---|---|---|
| `verify-scope-safety.js` | ~15 assertions | Unmatched queries, matched queries, read-only enforcement, cross-business rejection, audit trail |
| `verify-stage-a.js` | ~70 assertions | All 7 coordinator intents: 3 patterns each, agent_type, output keys, evidence, summary accuracy, empty handling, audit trail, business scoping, read-only, auth |
| `verify-stage-c.js` | ~25 assertions | Direct DB verification: agent_runs, agent_run_steps, audit_logs records exist with correct fields, credential exposure check, step failure recording, audit_logs immutability, auth/scoping |
| `verify-inventory-agent.js` | ~82 assertions | All 4 inventory agent intents: pattern matching, output structure, evidence, agent_type, source delegation, empty results, data-backed correctness (products with real expiry dates, suppliers, ILIKE safety), pattern collisions, multi-intent, regression, auth, read-only, run/step/audit status |
| **Total** | **~222 assertions** | Comprehensive coverage of existing 11 intents |

**Test gaps for new capabilities:**
- No tests for restocking recommendations
- No tests for stockout risk projection
- No tests for fast/slow mover analysis
- No tests for data quality checks
- No tests for explainability fields (reasoning, caveats, confidence)

---

## 3. Capability-to-Data Feasibility Matrix

### 3.1 Matrix

| # | Proposed Capability | Required Data | Available? | Reliability | Feasibility |
|---|---|---|---|---|---|
| 1 | **Inventory status analysis** (enhanced) | products: stock_quantity, min_stock_threshold, unit_cost, is_active | YES — direct query | HIGH — authoritative current state | **FULLY FEASIBLE** |
| 2 | **Restocking recommendations** | products: name, stock_quantity, min_stock_threshold, unit_cost, supplier_id; suppliers: name, contact_name, email, phone | YES — all fields exist | HIGH — direct query with supplier JOIN | **FULLY FEASIBLE** (with caveats on reorder quantity — heuristic only) |
| 3 | **Stockout risk** (immediate) | products: stock_quantity, min_stock_threshold, is_active | YES — direct query | HIGH — authoritative current state | **FULLY FEASIBLE** (for current stockout detection) |
| 3b | **Stockout risk** (projected) | stock_movements WHERE movement_type='sale' over time window + products.stock_quantity | CONDITIONAL — depends on businesses recording 'sale' movements | LOW-MEDIUM — sparse data makes projection unreliable | **CONDITIONALLY FEASIBLE** (must report data coverage and warn when sparse) |
| 4 | **Fast/slow movers** | stock_movements WHERE movement_type='sale' GROUP BY product_id, SUM(quantity_change * -1) | CONDITIONAL — same dependency on sale movement recording | LOW-MEDIUM — only reliable if sale movements are consistently recorded | **CONDITIONALLY FEASIBLE** (must report data coverage, classify non-movers separately) |
| 5 | **Natural-language queries** | Existing pattern-matching infrastructure | YES — `matchIntents()` already exists | HIGH — rule-based matching is deterministic | **FULLY FEASIBLE** (add more patterns/synonyms, no LLM needed) |
| 6 | **Data validation** | products: min_stock_threshold, supplier_id, unit_cost, expiry_date, is_active | YES — direct query on existing fields | HIGH — checks for NULL/zero/default values | **FULLY FEASIBLE** |
| 7 | **Explainability** | Existing step/evidence infrastructure | YES — add fields to output objects | HIGH — deterministic computation | **FULLY FEASIBLE** (add reasoning, data_sources, caveats, confidence fields) |

### 3.2 Data Reliability Assessment

| Data Source | Reliability | Rationale |
|---|---|---|
| `products` table (current state) | **HIGH** | Authoritative — stock_quantity is trigger-protected, always accurate after movements |
| `suppliers` table | **HIGH** | Direct business data, no trigger complications |
| `stock_movements` (existence) | **HIGH** | Append-only, cannot be tampered with |
| `stock_movements` (as demand signal) | **MEDIUM** | Exists but may be incomplete — businesses may not record all sales as stock movements |
| `stock_movements` (for velocity) | **LOW-MEDIUM** | Requires sufficient historical data (30+ days of consistent sale recordings) for meaningful analysis |
| `invoice_items` (as demand signal) | **UNUSABLE** | No `product_id` field — cannot link invoices to products |

### 3.3 What Genuinely Exists vs. What Was Assumed

| Assumption | Reality |
|---|---|
| ~~"Sales history exists"~~ | `invoice_items` has no `product_id` — invoice sales are NOT product-linked. Only `stock_movements WHERE movement_type='sale'` is a demand signal, and its completeness is unknown. |
| ~~"Supplier lead times exist"~~ | `suppliers` table has no `lead_time` field — reorder timing cannot be calculated. |
| ~~"Reorder policies exist"~~ | No `reorder_quantity`, `reorder_point` (beyond `min_stock_threshold`), or `max_stock_threshold` fields — only `min_stock_threshold` (default 0) exists. |
| ~~"Historical stock movements exist"~~ | `stock_movements` table exists and is append-only, but whether businesses record 'sale' movements consistently is unknown. Seed data has only 1 sale per product. |
| **"min_stock_threshold exists"** | TRUE — exists on products, default 0. Many products may have threshold=0 (never configured), making low-stock detection meaningless for those products. |
| **"unit_cost exists"** | TRUE — exists on products, default 0. Can be used for value calculations. |
| **"supplier_id exists"** | TRUE — nullable FK on products. Can be used for restocking contact info. |
| **"expiry_date exists"** | TRUE — nullable DATE on products. Already used by `near_expiry` intent. |

---

## 4. Proposed Recommendation Rules and Formulas

### 4.1 Design Principles (from user requirements)

1. **No fabricated data** — every recommendation must cite the exact data used
2. **Explicit caveats** — state what is NOT available and how it affects the recommendation
3. **No schema changes** — work with existing tables and fields only
4. **Read-only** — all intents use SELECT queries only, no writes
5. **Preserve safeguards** — trigger protections, business scoping, audit trail, rate limiting all remain intact
6. **Safe recommendation rules** — never fabricate reorder quantities, lead times, or demand rates

### 4.2 Rule Definitions

#### Rule 1: Enhanced Low Stock Alert (enhances existing `low_stock` intent)

**Trigger patterns (existing + new):**
- Existing: "low stock", "low-stock", "stock alert", "reorder", "restock", "running low"
- New: "what needs reordering", "stock below threshold", "below minimum"

**SQL query (enhanced):**
```sql
SELECT p.id, p.name, p.sku, p.stock_quantity, p.min_stock_threshold,
       p.unit_cost,
       (p.min_stock_threshold - p.stock_quantity) AS shortfall,
       CASE
         WHEN p.stock_quantity = 0 THEN 'critical'
         WHEN p.stock_quantity <= p.min_stock_threshold * 0.5 THEN 'high'
         ELSE 'medium'
       END AS severity,
       p.supplier_id,
       s.name AS supplier_name, s.contact_name AS supplier_contact,
       s.email AS supplier_email, s.phone AS supplier_phone,
       to_char(p.expiry_date, 'YYYY-MM-DD') AS expiry_date
FROM products p
LEFT JOIN suppliers s ON p.supplier_id = s.id AND s.business_id = $1
WHERE p.business_id = $1
  AND p.is_active = true
  AND p.stock_quantity <= p.min_stock_threshold
  AND p.min_stock_threshold > 0
ORDER BY
  CASE
    WHEN p.stock_quantity = 0 THEN 0
    WHEN p.stock_quantity <= p.min_stock_threshold * 0.5 THEN 1
    ELSE 2
  END,
  (p.min_stock_threshold - p.stock_quantity) DESC
LIMIT 20
```

**Key enhancement:** 
- Adds `severity` classification (critical/high/medium)
- Adds supplier contact info (name, contact_name, email, phone)
- Adds `shortfall` calculation
- Filters out products with `min_stock_threshold = 0` (not configured) and adds them to a separate `unconfigured_threshold` array

**Output structure:**
```json
{
  "items": [...],
  "count": 3,
  "critical_count": 1,
  "high_count": 1,
  "medium_count": 1,
  "unconfigured_threshold_count": 2,
  "unconfigured_threshold_items": [...],
  "reasoning": "Products below their configured minimum stock threshold, sorted by severity. Products with threshold=0 are listed separately as 'unconfigured'.",
  "data_sources": ["products", "suppliers"],
  "caveats": [
    "Severity is based on current stock vs. configured threshold. No demand velocity considered.",
    "Products with min_stock_threshold=0 are excluded from the main list because any stock quantity would trigger a false low-stock alert."
  ],
  "confidence": "high"
}
```

#### Rule 2: Restocking Recommendations (new intent: `restocking_recommendations`)

**Trigger patterns:**
- "restocking recommendations", "what to reorder", "reorder list", "purchase suggestions", "what should I buy", "restock plan", "replenish stock"

**SQL query:**
```sql
SELECT p.id, p.name, p.sku, p.stock_quantity, p.min_stock_threshold,
       p.unit_cost,
       (p.min_stock_threshold * 2 - p.stock_quantity) AS suggested_reorder_qty,
       ((p.min_stock_threshold * 2 - p.stock_quantity) * p.unit_cost) AS estimated_cost,
       (p.min_stock_threshold - p.stock_quantity) AS shortfall,
       p.supplier_id,
       s.name AS supplier_name, s.contact_name AS supplier_contact,
       s.email AS supplier_email, s.phone AS supplier_phone
FROM products p
LEFT JOIN suppliers s ON p.supplier_id = s.id AND s.business_id = $1
WHERE p.business_id = $1
  AND p.is_active = true
  AND p.stock_quantity <= p.min_stock_threshold
  AND p.min_stock_threshold > 0
ORDER BY (p.min_stock_threshold - p.stock_quantity) DESC
LIMIT 20
```

**Suggested reorder quantity formula:**
```
suggested_reorder_qty = max(min_stock_threshold * 2 - stock_quantity, min_stock_threshold - stock_quantity)
```
This simplifies to `min_stock_threshold * 2 - stock_quantity` when `stock_quantity < min_stock_threshold` (which is always true for results in this query).

**Rationale:** Order enough to reach 2× threshold (provides a buffer above the minimum). This is a heuristic, not an optimal EOQ calculation.

**Output structure:**
```json
{
  "recommendations": [
    {
      "product_id": "...",
      "name": "Cooking Oil",
      "sku": "OIL-001",
      "current_stock": 5,
      "threshold": 20,
      "shortfall": 15,
      "suggested_reorder_qty": 35,
      "unit_cost": 12.50,
      "estimated_cost": 437.50,
      "supplier_name": "Global Foods Sdn Bhd",
      "supplier_contact": "Alice Tan",
      "supplier_email": "alice@globalfoods.com",
      "supplier_phone": "+60123456789"
    }
  ],
  "count": 1,
  "total_estimated_cost": 437.50,
  "reasoning": "Products at or below their configured minimum threshold. Suggested reorder quantity aims to bring stock to 2x threshold for a safety buffer. Estimated cost is based on unit_cost from the product record.",
  "data_sources": ["products", "suppliers"],
  "caveats": [
    "Reorder quantity is a HEURISTIC based on min_stock_threshold. It is NOT an optimal Economic Order Quantity.",
    "No supplier lead time data is available — reorder timing cannot be determined. Order as soon as possible.",
    "No minimum order quantity from suppliers is available — the suggested quantity may be below supplier minimums.",
    "unit_cost may be 0 if not configured — estimated_cost will be 0 in that case."
  ],
  "confidence": "medium"
}
```

#### Rule 3: Stockout Risk (new intent: `stockout_risk`)

**Trigger patterns:**
- "stockout risk", "stock out risk", "out of stock risk", "what will run out", "stockout", "stock out", "run out of stock"

**SQL query (immediate stockout — always available):**
```sql
SELECT p.id, p.name, p.sku, p.stock_quantity, p.min_stock_threshold,
       CASE
         WHEN p.stock_quantity = 0 THEN 'stockout'
         WHEN p.stock_quantity <= p.min_stock_threshold THEN 'at_risk'
       END AS risk_level
FROM products p
WHERE p.business_id = $1
  AND p.is_active = true
  AND p.min_stock_threshold > 0
  AND p.stock_quantity <= p.min_stock_threshold
ORDER BY p.stock_quantity ASC
LIMIT 20
```

**SQL query (projected stockout — conditional, requires sale movements):**
```sql
SELECT p.id, p.name, p.sku, p.stock_quantity,
       ABS(SUM(sm.quantity_change)) AS total_sold_30d,
       (ABS(SUM(sm.quantity_change)) / 30.0) AS daily_velocity,
       CASE
         WHEN ABS(SUM(sm.quantity_change)) = 0 THEN NULL
         ELSE (p.stock_quantity / (ABS(SUM(sm.quantity_change)) / 30.0))
       END AS projected_days_until_stockout
FROM products p
LEFT JOIN stock_movements sm ON sm.product_id = p.id
  AND sm.business_id = $1
  AND sm.movement_type = 'sale'
  AND sm.created_at >= CURRENT_DATE - INTERVAL '30 days'
WHERE p.business_id = $1
  AND p.is_active = true
  AND p.stock_quantity > 0
GROUP BY p.id, p.name, p.sku, p.stock_quantity
HAVING COUNT(sm.id) > 0
ORDER BY projected_days_until_stockout ASC NULLS LAST
LIMIT 20
```

**Output structure:**
```json
{
  "stockout_now": [...],      // stock_quantity = 0
  "at_risk": [...],           // stock_quantity <= min_stock_threshold
  "projected": [              // only if sale movements exist
    {
      "name": "Cooking Oil",
      "stock_quantity": 15,
      "total_sold_30d": 30,
      "daily_velocity": 1.0,
      "projected_days_until_stockout": 15,
      "projection_note": "Based on 30 days of sale movements"
    }
  ],
  "projection_available": true,
  "total_sale_movements_30d": 5,
  "reasoning": "Immediate stockout and at-risk products are identified from current stock levels. Projected stockout dates are calculated from sale-type stock movements in the last 30 days.",
  "data_sources": ["products", "stock_movements"],
  "caveats": [
    "Projected stockout dates are based ONLY on sale-type stock movements. If sales are not recorded as stock movements, projections are not available.",
    "Projection assumes constant demand — actual demand may vary by day of week, season, or promotions.",
    "Products with no sale movements in the last 30 days are excluded from projection — their risk cannot be assessed.",
    "No supplier lead time data is available — cannot determine if reorder will arrive before stockout."
  ],
  "confidence": "medium"
}
```

**Fallback when no sale movements exist:**
```json
{
  "stockout_now": [...],
  "at_risk": [...],
  "projected": [],
  "projection_available": false,
  "total_sale_movements_30d": 0,
  "reasoning": "Immediate stockout and at-risk products identified. Projection not available — no sale-type stock movements recorded in the last 30 days.",
  "caveats": [
    "Stockout projection requires sale-type stock movements. None found in the last 30 days.",
    "Consider recording stock movements with movement_type='sale' when products are sold to enable future projections."
  ],
  "confidence": "high"
}
```

#### Rule 4: Fast/Slow Mover Analysis (new intent: `fast_slow_movers`)

**Trigger patterns:**
- "fast moving", "slow moving", "fast movers", "slow movers", "movers analysis", "product velocity", "what sells fast", "what sells slowly", "top sellers", "worst sellers"

**SQL query:**
```sql
SELECT p.id, p.name, p.sku, p.stock_quantity,
       COALESCE(ABS(SUM(sm.quantity_change)), 0) AS total_sold_30d,
       COUNT(sm.id) AS sale_movement_count
FROM products p
LEFT JOIN stock_movements sm ON sm.product_id = p.id
  AND sm.business_id = $1
  AND sm.movement_type = 'sale'
  AND sm.created_at >= CURRENT_DATE - INTERVAL '30 days'
WHERE p.business_id = $1
  AND p.is_active = true
GROUP BY p.id, p.name, p.sku, p.stock_quantity
ORDER BY total_sold_30d DESC
LIMIT 50
```

**Classification logic (in JS after query):**
```javascript
// Products with at least 1 sale movement
const movers = rows.filter(r => r.sale_movement_count > 0);
// Products with 0 sale movements
const nonMovers = rows.filter(r => r.sale_movement_count === 0);

// Rank movers by total_sold_30d
movers.sort((a, b) => b.total_sold_30d - a.total_sold_30d);

// Top 20% = fast movers, bottom 20% = slow movers
const cutoff = Math.max(1, Math.ceil(movers.length * 0.2));
const fastMovers = movers.slice(0, cutoff);
const slowMovers = movers.slice(-cutoff);
const mediumMovers = movers.slice(cutoff, movers.length - cutoff);
```

**Output structure:**
```json
{
  "period_days": 30,
  "total_products": 50,
  "products_with_sales": 10,
  "products_without_sales": 40,
  "total_sale_movements": 15,
  "fast_movers": [...],
  "slow_movers": [...],
  "non_movers": [...],
  "reasoning": "Products ranked by total sale quantity in the last 30 days. Fast movers = top 20%, slow movers = bottom 20% (among products with at least 1 sale). Products with no sale movements are listed separately as 'non_movers'.",
  "data_sources": ["products", "stock_movements"],
  "caveats": [
    "Analysis is based ONLY on sale-type stock movements. If sales are not recorded as stock movements, results are unreliable.",
    "Only 10 of 50 products have sale movements in the last 30 days — 40 products are classified as 'non_movers'.",
    "Total sale movements in period: 15. This may indicate inconsistent recording of sales as stock movements.",
    "Fast/slow classification is relative to this business's own products — not industry benchmarks."
  ],
  "confidence": "low"
}
```

#### Rule 5: Data Quality Check (new intent: `data_quality_check`)

**Trigger patterns:**
- "data quality", "inventory data quality", "missing data", "incomplete products", "data gaps", "inventory health check", "data validation"

**SQL query (multiple checks in one query):**
```sql
SELECT
  COUNT(*) FILTER (WHERE min_stock_threshold = 0) AS no_threshold,
  COUNT(*) FILTER (WHERE supplier_id IS NULL) AS no_supplier,
  COUNT(*) FILTER (WHERE unit_cost = 0) AS no_cost,
  COUNT(*) FILTER (WHERE expiry_date IS NULL) AS no_expiry_date,
  COUNT(*) FILTER (WHERE is_active = false) AS inactive,
  COUNT(*) AS total_products
FROM products
WHERE business_id = $1
```

**Detail queries (only if issues found):**
```sql
-- Products with no threshold
SELECT id, name, sku, stock_quantity FROM products
WHERE business_id = $1 AND is_active = true AND min_stock_threshold = 0
LIMIT 10

-- Products with no supplier
SELECT id, name, sku, supplier_id FROM products
WHERE business_id = $1 AND is_active = true AND supplier_id IS NULL
LIMIT 10
```

**Output structure:**
```json
{
  "total_products": 50,
  "issues": {
    "no_threshold": 15,
    "no_supplier": 8,
    "no_cost": 3,
    "no_expiry_date": 35,
    "inactive": 2
  },
  "issue_details": {
    "no_threshold_products": [...],
    "no_supplier_products": [...]
  },
  "reasoning": "Checks for products with missing or default-valued fields that may indicate incomplete data setup.",
  "data_sources": ["products"],
  "caveats": [
    "min_stock_threshold defaults to 0 — products showing 'no_threshold' may not have been configured with a reorder level.",
    "expiry_date is nullable — 'no_expiry_date' is informational, not necessarily an error (some products don't have expiry dates).",
    "unit_cost defaults to 0 — products showing 'no_cost' may not have had their cost recorded, affecting value calculations."
  ],
  "confidence": "high"
}
```

#### Rule 6: Enhanced Inventory Summary (enhances existing `inventory_summary` intent)

**Additional fields added to existing query:**
```sql
SELECT
  COUNT(*) AS total_products,
  COUNT(*) FILTER (WHERE is_active = true) AS active_products,
  COUNT(*) FILTER (WHERE is_active = false) AS inactive_products,
  COALESCE(SUM(stock_quantity * unit_cost), 0) AS total_value,
  COUNT(*) FILTER (WHERE stock_quantity <= min_stock_threshold AND is_active = true AND min_stock_threshold > 0) AS low_stock_count,
  COUNT(*) FILTER (WHERE stock_quantity = 0 AND is_active = true) AS out_of_stock_count,
  COUNT(*) FILTER (WHERE min_stock_threshold = 0 AND is_active = true) AS unconfigured_threshold_count,
  COUNT(*) FILTER (WHERE supplier_id IS NULL AND is_active = true) AS no_supplier_count,
  COUNT(*) FILTER (WHERE unit_cost = 0 AND is_active = true) AS no_cost_count,
  COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + INTERVAL '7 days' AND is_active = true) AS near_expiry_count
FROM products
WHERE business_id = $1
```

**New output fields (in addition to existing):**
```json
{
  "total_products": 50,
  "active_products": 48,
  "inactive_products": 2,
  "total_value": 12500.00,
  "low_stock_count": 5,
  "out_of_stock_count": 2,
  "unconfigured_threshold_count": 15,
  "no_supplier_count": 8,
  "no_cost_count": 3,
  "near_expiry_count": 1,
  "reasoning": "Snapshot of current inventory state. Low stock count only includes products with configured thresholds (min_stock_threshold > 0).",
  "data_sources": ["products"],
  "caveats": [
    "15 products have min_stock_threshold=0 — they are excluded from low_stock_count because any stock quantity would trigger a false alert.",
    "Value calculation uses unit_cost — 3 products have unit_cost=0, so their value is not included."
  ],
  "confidence": "high"
}
```

#### Rule 7: Explainability Enhancement (cross-cutting, applied to all intents)

**New fields added to every intent's output:**

| Field | Type | Purpose |
|---|---|---|
| `reasoning` | string | Human-readable explanation of what was computed and why |
| `data_sources` | string[] | List of table names queried |
| `caveats` | string[] | Data quality warnings and limitations |
| `confidence` | string | "high" (direct query), "medium" (heuristic), "low" (sparse/incomplete data) |

**Confidence levels:**
- `high` — direct query of authoritative data (products table current state)
- `medium` — heuristic calculation or partially available data (restocking suggestions, stockout projection with some sale data)
- `low` — analysis based on sparse or potentially incomplete data (fast/slow movers with few sale movements)

---

## 5. Prioritised Implementation Plan

### Priority 1: High Impact, Fully Data-Backed (recommended first)

| # | Intent | Type | Effort | Impact |
|---|---|---|---|---|
| P1.1 | Enhanced `low_stock` | Enhance existing | Small | Adds severity, supplier contact, shortfall, filters out unconfigured thresholds |
| P1.2 | `restocking_recommendations` | New intent | Medium | Comprehensive restocking view with supplier contact info and estimated costs |
| P1.3 | `data_quality_check` | New intent | Small | Identifies missing data (threshold=0, no supplier, cost=0) |

**Rationale:** These are fully data-backed from existing schema fields. No conditional logic or data-availability checks needed. Immediate value to users.

### Priority 2: High Impact, Conditionally Data-Backed

| # | Intent | Type | Effort | Impact |
|---|---|---|---|---|
| P2.1 | `stockout_risk` | New intent | Medium | Immediate stockout + projected risk (with caveats when data unavailable) |
| P2.2 | `fast_slow_movers` | New intent | Medium | Sale movement analysis (with explicit data coverage reporting) |
| P2.3 | Enhanced `inventory_summary` | Enhance existing | Small | Adds active/inactive, data quality counts, near expiry count |

**Rationale:** High value but requires careful handling of data availability. Must explicitly report data coverage and warn when sparse. Confidence level must reflect data quality.

### Priority 3: Enhancement, Low Risk

| # | Intent | Type | Effort | Impact |
|---|---|---|---|---|
| P3.1 | Explainability fields | Cross-cutting | Medium | Add reasoning, data_sources, caveats, confidence to ALL intents |
| P3.2 | Enhanced `inventory_by_supplier` | Enhance existing | Small | Add low-stock count per supplier, total value at risk |
| P3.3 | Enhanced `near_expiry` | Enhance existing | Small | Add days until expiry, suggested action per product |
| P3.4 | Additional NL patterns | All intents | Small | Add synonyms and natural-language variations to pattern lists |

**Rationale:** Improves quality and usability of existing and new intents without adding new capabilities. Low risk of regression.

### Priority 4: Nice to Have (deferred)

| # | Intent | Type | Notes |
|---|---|---|---|
| P4.1 | Inventory health score | New intent | Composite metric — needs design decisions on weighting |
| P4.2 | Enhanced fallback response | Enhancement | List new capabilities in fallback message |

**Rationale:** Lower priority — can be done after core improvements are validated.

### Implementation Order (recommended)

```
Stage 2:  P1.1 (enhanced low_stock) + P1.3 (data_quality_check) + P3.1 (explainability on new intents)
Stage 3:  P1.2 (restocking_recommendations) + P2.3 (enhanced inventory_summary)
Stage 4:  P2.1 (stockout_risk) + P2.2 (fast_slow_movers)
Stage 5:  P3.2 (enhanced inventory_by_supplier) + P3.3 (enhanced near_expiry) + P3.4 (NL patterns) + P4.2 (fallback)
Stage 6:  P4.1 (health score) — only if approved
```

### Files to be modified (planned for Stage 2+)

| File | Changes |
|---|---|
| `backend/src/services/inventoryAgent.js` | Add new intents, enhance existing intents, add explainability fields |
| `backend/src/services/coordinator.js` | Update `formatStepSummary()` for new intents, update `formatFallbackResponse()` |
| `verify-inventory-agent.js` | Add test cases for new/enhanced intents |

**Files NOT to be modified:**
- No migration files (no schema changes)
- No route files (no new API endpoints — agent uses direct SQL)
- No middleware files (auth, rate limiting, business access all unchanged)
- No frontend files (agent improvements are backend-only)
- No `.env` or config files

---

## 6. Test Plan with Expected Results

### 6.1 Test Strategy

Each new/enhanced intent will be tested with:
1. **Pattern matching** — all trigger patterns match the correct intent
2. **Pattern collision** — new patterns don't collide with existing 11 intents
3. **Output structure** — all expected fields are present
4. **Evidence source** — correct `evidence.source` value
5. **Empty result** — new business with no products returns sensible empty state
6. **Data-backed correctness** — create test data, verify correct output
7. **Edge cases** — threshold=0, no supplier, no expiry, no sale movements
8. **Caveat/warning verification** — data quality warnings appear when expected
9. **Explainability fields** — reasoning, data_sources, caveats, confidence present
10. **Regression** — existing 11 intents still work
11. **Cross-business isolation** — 403 on cross-business access
12. **Read-only enforcement** — no write endpoints

### 6.2 Specific Test Cases

#### Enhanced `low_stock` (P1.1)

| Test | Setup | Expected |
|---|---|---|
| LS-1: Severity classification | Product A: stock=0, threshold=10; Product B: stock=4, threshold=10; Product C: stock=9, threshold=10 | A: critical, B: high, C: medium |
| LS-2: Supplier contact info | Product with supplier_id pointing to supplier with name/contact/email/phone | Output includes supplier_name, supplier_contact, supplier_email, supplier_phone |
| LS-3: Unconfigured threshold filtering | Product with threshold=0 | NOT in `items`; counted in `unconfigured_threshold_count` |
| LS-4: Shortfall calculation | stock=5, threshold=20 | shortfall = 15 |
| LS-5: Explainability fields | Any result | `reasoning`, `data_sources`, `caveats`, `confidence` all present |
| LS-6: Empty result | New business, no products | count=0, unconfigured_threshold_count=0, caveats mention no products |

#### `restocking_recommendations` (P1.2)

| Test | Setup | Expected |
|---|---|---|
| RR-1: Suggested reorder quantity | stock=5, threshold=20 | suggested_reorder_qty = 35 (20*2 - 5) |
| RR-2: Estimated cost | stock=5, threshold=20, unit_cost=10.00 | estimated_cost = 350.00 (35 * 10) |
| RR-3: Supplier contact | Product with supplier | recommendation includes supplier_name, supplier_email, supplier_phone |
| RR-4: No supplier | Product without supplier_id | supplier fields are null/absent |
| RR-5: Total estimated cost | Multiple products | `total_estimated_cost` = sum of all estimated costs |
| RR-6: Caveat about heuristic | Any result | caveats mention "HEURISTIC", "not optimal EOQ", "no lead time" |
| RR-7: Confidence | Any result | confidence = "medium" |
| RR-8: Empty result | No low-stock products | count=0, message "No products need restocking" |
| RR-9: unit_cost = 0 | Product with unit_cost=0 | estimated_cost = 0, caveat about unit_cost=0 |

#### `data_quality_check` (P1.3)

| Test | Setup | Expected |
|---|---|---|
| DQ-1: No threshold products | Products with min_stock_threshold=0 | `no_threshold` count > 0, detail products listed |
| DQ-2: No supplier products | Products with supplier_id=NULL | `no_supplier` count > 0 |
| DQ-3: No cost products | Products with unit_cost=0 | `no_cost` count > 0 |
| DQ-4: No expiry date | Products with expiry_date=NULL | `no_expiry_date` count > 0, caveat says "informational" |
| DQ-5: All clean | All products have threshold, supplier, cost, expiry | All issue counts = 0 |
| DQ-6: Confidence | Any result | confidence = "high" |

#### `stockout_risk` (P2.1)

| Test | Setup | Expected |
|---|---|---|
| SR-1: Immediate stockout | Product with stock=0 | In `stockout_now` array |
| SR-2: At risk | Product with stock <= threshold (but > 0) | In `at_risk` array |
| SR-3: Projection with data | Product with 3 sale movements in 30 days, total sold=30 | daily_velocity=1.0, projected_days=stock/1.0 |
| SR-4: Projection without data | No sale movements | `projection_available=false`, caveat about recording sale movements |
| SR-5: Confidence with data | Has sale movements | confidence = "medium" |
| SR-6: Confidence without data | No sale movements | confidence = "high" (for immediate stockout, still authoritative) |
| SR-7: Caveat about lead time | Any result | caveat mentions "no supplier lead time data" |

#### `fast_slow_movers` (P2.2)

| Test | Setup | Expected |
|---|---|---|
| FS-1: Fast mover | Product with high sale quantity in 30 days | In `fast_movers` (top 20%) |
| FS-2: Slow mover | Product with low sale quantity | In `slow_movers` (bottom 20%) |
| FS-3: Non-mover | Product with 0 sale movements | In `non_movers` |
| FS-4: No sale movements at all | Business with no sale-type stock_movements | All products in `non_movers`, confidence = "low", caveat about recording sales |
| FS-5: Data coverage reporting | 5 of 20 products have sales | `products_with_sales=5`, `products_without_sales=15`, caveats mention the ratio |
| FS-6: 30-day window | Sale movement 31 days old | NOT counted in total_sold_30d |

#### Enhanced `inventory_summary` (P2.3)

| Test | Setup | Expected |
|---|---|---|
| IS-1: Active/inactive count | 48 active, 2 inactive | `active_products=48`, `inactive_products=2` |
| IS-2: Unconfigured threshold count | 15 products with threshold=0 | `unconfigured_threshold_count=15` |
| IS-3: Low stock excludes unconfigured | 5 low stock products, 15 with threshold=0 | `low_stock_count=5` (only those with threshold > 0) |
| IS-4: Near expiry count | 1 product expiring in 3 days | `near_expiry_count=1` |
| IS-5: No supplier count | 8 products without supplier | `no_supplier_count=8` |
| IS-6: Regression | All existing fields still present | `total_products`, `total_value`, `low_stock_count`, `out_of_stock_count` unchanged |

#### Pattern Collision Tests

| Test | Goal | Expected |
|---|---|---|
| PC-1: "restock" | Should match `restocking_recommendations` (new) AND `low_stock` (existing) | Both match — multi-intent |
| PC-2: "reorder" | Should match `low_stock` (existing) AND `restocking_recommendations` (new) | Both match — multi-intent |
| PC-3: "stock out" | Should match `stockout_risk` (new) | Only `stockout_risk` — NOT `stock_movement_history` |
| PC-4: "data quality" | Should match `data_quality_check` (new) | Only `data_quality_check` |
| PC-5: "fast moving" | Should match `fast_slow_movers` (new) | Only `fast_slow_movers` |

**Note on "restock"/"reorder" collision:** These patterns currently exist in `low_stock`. If `restocking_recommendations` also uses them, both intents will match — this is the existing multi-intent behavior and is acceptable. The user gets both a low-stock list and restocking recommendations, which is complementary.

---

## 7. Risks and Unresolved Questions

### 7.1 Technical Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Pattern collision** — new intent patterns may overlap with existing 11 intents | Medium | Low (multi-intent is existing behavior) | Carefully design patterns; add collision tests (PC-1 through PC-5) |
| R2 | **Performance** — fast/slow mover analysis requires GROUP BY on stock_movements | Low | Medium (may be slow for businesses with many movements) | Use 30-day time window, LIMIT 50, index on (business_id, movement_type, created_at) exists via query pattern |
| R3 | **Date handling** — `pg` returns DATE as JS Date objects | Low | High (silent data corruption in comparisons) | Continue using `to_char(expiry_date, 'YYYY-MM-DD')` pattern from existing `near_expiry` intent |
| R4 | **Division by zero** — daily_velocity = total_sold / 30, projected_days = stock / velocity | Low | Medium (runtime error) | Guard with CASE WHEN / HAVING COUNT > 0 |
| R5 | **NUMERIC precision** — `pg` returns NUMERIC as string by default | Low | Low (need parseFloat) | Continue using `parseFloat()` on all NUMERIC fields, same as existing intents |

### 7.2 Data Quality Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| D1 | **min_stock_threshold = 0** — many products may have unconfigured thresholds | High | High (false low-stock alerts) | Filter out threshold=0 products from low_stock; report them in `unconfigured_threshold_count`; add caveat |
| D2 | **No sale movements recorded** — businesses may not record sale-type stock movements | High | High (fast/slow and stockout projection unusable) | Check `total_sale_movements_30d` and set `projection_available=false`; add caveats; classify as `non_movers` |
| D3 | **unit_cost = 0** — products may not have cost configured | Medium | Medium (estimated cost = 0) | Include in data_quality_check; caveat in restocking recommendations |
| D4 | **No supplier assigned** — products may not have supplier_id | Medium | Medium (no restocking contact info) | Include in data_quality_check; show null supplier fields in restocking |
| D5 | **Inconsistent sale recording** — some sales recorded, most not | Medium | High (misleading velocity calculations) | Report `products_with_sales` vs `products_without_sales` ratio; set confidence = "low" when ratio < 50% |

### 7.3 Design Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| G1 | **Over-engineering** — adding too many intents may overwhelm users | Medium | Low | Keep intent count manageable; combine related intents where sensible |
| G2 | **Heuristic accuracy** — suggested reorder quantity (2x threshold) is a rough heuristic | High | Medium | Explicitly label as heuristic in caveats; do not present as optimal |
| G3 | **Confidence scoring** — "high/medium/low" is subjective | Medium | Low | Define criteria clearly (Section 4.2, Rule 7); apply consistently |

### 7.4 Unresolved Questions

| # | Question | Default Decision | Needs User Input? |
|---|---|---|---|
| Q1 | Should `restocking_recommendations` and `low_stock` both trigger on "restock"/"reorder", or should one take priority? | Both trigger (multi-intent, existing behavior) | Optional — confirm acceptable |
| Q2 | Should the 30-day window for fast/slow movers and stockout projection be configurable? | Fixed at 30 days | No — keep simple |
| Q3 | Should `data_quality_check` return detail lists for all issue types, or just counts? | Counts + details for top 10 per issue type | No — keep as designed |
| Q4 | Should the enhanced `inventory_summary` replace the existing intent or be a separate intent? | Enhance existing (additive, no breaking changes) | No — additive only |
| Q5 | Should `stockout_risk` combine immediate + projected, or should they be separate intents? | Combined in one intent with `projection_available` flag | No — keep as designed |
| Q6 | Should inventory health score (P4.1) be implemented? | Deferred until core improvements validated | Yes — defer to later stage |
| Q7 | Should the agent suggest specific actions (e.g., "contact supplier X") or just present data? | Present data + suggest action in `reasoning` field, but do NOT auto-execute | No — keep read-only |

---

## 8. No-Change Confirmation

**This stage was inspection and design only. The following were NOT modified:**

| Category | Status |
|---|---|
| **Source code** (`.js` files) | NOT MODIFIED — no code changes in `coordinator.js`, `inventoryAgent.js`, `inventory.js`, `agent.js`, or any other file |
| **Database schema** (migration files) | NOT MODIFIED — no migrations added, no tables/columns/constraints created or altered |
| **Database data** (seed data, test data) | NOT MODIFIED — no INSERT/UPDATE/DELETE executed on any table |
| **Configuration** (`.env`, `app.js`, `package.json`) | NOT MODIFIED — no config files changed |
| **Test files** | NOT MODIFIED — no test files created or modified |
| **Frontend** (React/Vite files) | NOT MODIFIED — no frontend changes |
| **Middleware** (auth, rate limiting, business access) | NOT MODIFIED — no middleware changes |

**Actions taken in this stage:**
1. READ all 8 migration files (001-008) — for schema verification
2. READ `seed.sql` — for baseline data reference
3. READ `inventoryAgent.js` — for current inventory agent capabilities
4. READ `coordinator.js` — for coordinator architecture and intent matching
5. READ `agent.js` (routes) — for API endpoint structure
6. READ `inventory.js` (routes) — for inventory REST API and SQL queries
7. READ `API_CONTRACT.md` — for full API documentation
8. READ all 4 test suites — for current test coverage
9. COMPILED this design report

**No files were created, modified, or deleted. This report is the sole deliverable of Stage 1.**

---

## Appendix A: Current Intent Pattern Reference

### Coordinator Intents (7)

| Intent | Patterns |
|---|---|
| `low_stock` | "low stock", "low-stock", "stock alert", "reorder", "restock", "running low" |
| `inventory_summary` | "inventory summary", "stock summary", "how much stock", "inventory status", "product count" |
| `task_overview` | "task summary", "overdue task", "task overview", "what tasks", "task status", "pending task" |
| `team_workload` | "workload", "team workload", "who is busy", "assignment", "team capacity", "team members" |
| `financial_overview` | "financial summary", "financial overview", "revenue", "invoice summary", "cashflow", "cash flow", "outstanding" |
| `customer_summary` | "customer summary", "how many customers", "customer list", "client" |
| `marketing_overview` | "marketing summary", "marketing overview", "campaign status", "marketing status", "how many campaigns" |

### Inventory Agent Intents (4)

| Intent | Patterns |
|---|---|
| `product_search` | "find product", "search product", "look up product", "product details", "product info" |
| `near_expiry` | "near expiry", "expiring", "about to expire", "expire soon", "expiry date", "expiring soon" |
| `stock_movement_history` | "stock movement", "recent movement", "stock history", "stock changes", "movement history" |
| `inventory_by_supplier` | "by supplier", "supplier breakdown", "supplier inventory", "inventory by supplier", "supplier summary" |

## Appendix B: Architecture Diagram (text)

```
User Goal (natural language)
       |
       v
  POST /api/businesses/:businessId/agent/runs
       |
       v
  coordinator.js: matchIntents(goalText)
       |
       |--- substring match against ALL_INTENTS (11 existing + new)
       |
       v
  For each matched intent:
       |
       |--- Coordinator intent? → intent.execute(businessId) in coordinator.js
       |--- Inventory agent intent? → intent.execute(businessId, goal) in inventoryAgent.js
       |
       v
  SQL query (SELECT only, parameterized, business-scoped)
       |
       v
  formatStepSummary(intent, output) → _summary string
       |
       v
  agent_run_steps record (status, input, output, evidence)
  audit_logs record (action, entity_type, entity_id, changes)
       |
       v
  final_report: { summary, matched_intents, step_count, completed, failed }
       |
       v
  agent_runs record (status='completed', final_report)
  audit_logs record (agent_run_completed)
```

**All new intents follow this exact flow.** The coordinator's `runCoordinator()` function handles step creation, execution, evidence recording, audit logging, and final report aggregation. New intents only need to define their `id`, `agent_type`, `label`, `source`, `patterns`, and `execute()` function, then be added to the `INVENTORY_INTENTS` array (for inventory agent intents) or `INTENT_REGISTRY` (for coordinator intents). The coordinator automatically includes them in `ALL_INTENTS` via the spread operator.

---

*End of Stage 1 Design Report. Awaiting user review and approval before proceeding to Stage 2 (implementation).*
