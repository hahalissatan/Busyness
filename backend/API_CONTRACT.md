# BizPilot AI — API Contract

> Complete reference for all backend endpoints, schemas, status transitions, and cross-cutting conventions.

## Table of Contents

1. [Conventions](#conventions)
2. [Authentication & Authorization](#authentication--authorization)
3. [Health Endpoints](#health-endpoints)
4. [Auth Endpoints](#auth-endpoints)
5. [Business Endpoints](#business-endpoints)
6. [Financial Hub API](#financial-hub-api)
7. [Inventory API](#inventory-api)
8. [Task Allocation API](#task-allocation-api)
9. [Marketing & Pitch Deck API](#marketing--pitch-deck-api)
10. [Error Responses](#error-responses)
11. [Status Transition Maps](#status-transition-maps)

---

## Conventions

| Convention | Value |
|---|---|
| Base URL | `/api` |
| Auth | Bearer JWT in `Authorization` header |
| Business scoping | All business-scoped routes under `/api/businesses/:businessId/...` |
| Content-Type | `application/json` |
| Pagination defaults | `page=1`, `limit=20`, `limit_max=100` |
| List response | `{ data: [], pagination: { page, limit, total, total_pages } }` |
| Create response | `201` with created resource |
| Update response | `200` with updated resource |
| Delete response | `204` no body |
| Validation errors | `400` with `{ error: "Validation failed", details: { errors: [...] } }` |
| UUID validation | All ID parameters validated as UUID v4 |
| Monetary fields | `NUMERIC(12,2)` — returned as string by PostgreSQL |
| Timestamps | `TIMESTAMPTZ` — ISO 8601 format |

---

## Authentication & Authorization

### Auth Flow

1. **Register** → creates user + business + owner membership transactionally → returns JWT
2. **Login** → verifies credentials → returns JWT
3. **All subsequent requests** → `Authorization: Bearer <token>`
4. **Business access** → `requireBusinessAccess` middleware checks `business_memberships` table

### JWT Payload

```json
{ "userId": "uuid", "email": "user@example.com", "name": "User Name" }
```

- Token expiry: `JWT_EXPIRES_IN` (default 7d)
- No `business_id` in token — resolved per-request from URL param

### Roles

| Role | Description |
|---|---|
| `owner` | Full access, created at registration |
| `manager` | Management-level access (future use) |
| `staff` | Staff-level access (future use) |

### Rate Limiting

| Scope | Limit | Window |
|---|---|---|
| General (all routes) | 100 requests | 15 minutes |
| Auth (`/api/auth/*`) | 10 requests | 15 minutes |
| Tests (NODE_ENV=test) | 10000 requests | 15 minutes |

---

## Health Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | None | API status check |
| GET | `/api/health/db` | None | Database connection test |

### GET /api/health

```json
{ "status": "ok", "service": "Busyness API" }
```

### GET /api/health/db

```json
{ "database": "connected", "service": "Busyness API" }
```

---

## Auth Endpoints

### POST /api/auth/register

Creates a new user, business, and owner membership (transactional).

**Request:**
```json
{
  "email": "user@example.com",
  "password": "Password123!",
  "name": "User Name",
  "business_name": "My Business"
}
```

**Response (201):**
```json
{
  "token": "eyJ...",
  "user": { "id": "uuid", "email": "user@example.com", "name": "User Name" },
  "business": { "id": "uuid", "name": "My Business" },
  "membership": { "id": "uuid", "role": "owner" }
}
```

### POST /api/auth/login

**Request:**
```json
{
  "email": "user@example.com",
  "password": "Password123!"
}
```

**Response (200):**
```json
{
  "token": "eyJ...",
  "user": { "id": "uuid", "email": "user@example.com", "name": "User Name" }
}
```

---

## Business Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/businesses/:businessId/me` | Bearer | Get current user's membership info |

### GET /api/businesses/:businessId/me

**Response (200):**
```json
{
  "user": { "id": "uuid", "email": "...", "name": "..." },
  "business": { "id": "uuid", "name": "..." },
  "membership": { "id": "uuid", "role": "owner" }
}
```

---

## Financial Hub API

Base path: `/api/businesses/:businessId/financials`

### Customers

| Method | Path | Description |
|---|---|---|
| POST | `/customers` | Create a customer |
| GET | `/customers` | List customers (search, pagination) |
| GET | `/customers/:customerId` | Get customer detail |
| PATCH | `/customers/:customerId` | Update customer |

**POST /customers — Request:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+60123456789",
  "address": "123 Main St"
}
```

**GET /customers — Query params:**
| Param | Type | Default | Description |
|---|---|---|---|
| `page` | int | 1 | Page number |
| `limit` | int | 20 | Items per page (max 100) |
| `search` | string | — | ILIKE search on name, email, phone |

**PATCH /customers/:customerId — Protected fields:** `business_id`

### Invoices

| Method | Path | Description |
|---|---|---|
| POST | `/invoices` | Create an invoice with line items |
| GET | `/invoices` | List invoices (status filter, pagination) |
| GET | `/invoices/:invoiceId` | Get invoice detail (items + payment summary) |
| PATCH | `/invoices/:invoiceId/status` | Update invoice status |

**POST /invoices — Request:**
```json
{
  "customer_id": "uuid",
  "issue_date": "2026-01-01",
  "due_date": "2026-01-31",
  "items": [
    {
      "product_name": "Widget",
      "quantity": 5,
      "unit_price": 19.99,
      "tax_rate": 6.00,
      "discount": 0.00
    }
  ]
}
```

**Invoice statuses:** `draft` → `unpaid` → `overdue` (manual transitions) | `partially_paid`, `paid` (payment-driven, terminal)

**PATCH /invoices/:invoiceId/status — Allowed transitions:**
| From | To |
|---|---|
| `draft` | `unpaid` |
| `unpaid` | `overdue` |
| `overdue` | `unpaid` |

**Protected fields on PATCH:** `business_id`, `status` (use status endpoint), `subtotal`, `tax_total`, `total`, `paid_amount`, `customer_id`

### Payments

| Method | Path | Description |
|---|---|---|
| POST | `/payments` | Record a payment (idempotent) |
| GET | `/payments` | List payments |

**POST /payments — Request:**
```json
{
  "invoice_id": "uuid",
  "amount": 99.95,
  "payment_method": "bank_transfer",
  "idempotency_key": "unique-key-123",
  "payment_date": "2026-01-15"
}
```

**Idempotency:** First call → `201`, duplicate `idempotency_key` → `200` (returns existing payment). Overpayment is rejected (`400`).

**GET /payments — Response:**
```json
{ "data": [], "count": 0 }
```

> Note: Payment listing returns `count` instead of `pagination` object. This is a minor inconsistency.

---

## Inventory API

Base path: `/api/businesses/:businessId/inventory`

### Products

| Method | Path | Description |
|---|---|---|
| POST | `/products` | Create a product |
| GET | `/products` | List products (search, active filter, pagination) |
| GET | `/products/:productId` | Get product detail (with supplier) |
| PATCH | `/products/:productId` | Update product |
| POST | `/products/:productId/deactivate` | Soft-delete (set `is_active = false`) |

**POST /products — Request:**
```json
{
  "name": "Widget",
  "sku": "WDG-001",
  "description": "A useful widget",
  "unit_price": 19.99,
  "cost_price": 10.00,
  "reorder_threshold": 5.00,
  "supplier_id": "uuid"
}
```

**Protected fields on PATCH:** `business_id`, `stock_quantity` (updated via stock movements only), `supplier_id`

### Suppliers

| Method | Path | Description |
|---|---|---|
| POST | `/suppliers` | Create a supplier |
| GET | `/suppliers` | List suppliers (search, pagination) |
| GET | `/suppliers/:supplierId` | Get supplier detail |
| PATCH | `/suppliers/:supplierId` | Update supplier |

### Stock Movements

| Method | Path | Description |
|---|---|---|
| POST | `/stock-movements` | Record a stock movement (transactional) |
| GET | `/products/:productId/stock-movements` | List movements for a product |
| GET | `/stock-movements` | List all movements (type filter) |

**POST /stock-movements — Request:**
```json
{
  "product_id": "uuid",
  "movement_type": "purchase",
  "quantity": 10.00,
  "unit_cost": 10.00,
  "reason": "Restocking"
}
```

**Movement types & sign conventions:**
| Type | Sign | Description |
|---|---|---|
| `purchase` | + | Stock in from supplier |
| `return` | + | Customer return |
| `sale` | − | Stock out to customer |
| `writeoff` | − | Damaged/expired |
| `adjustment` | ± | Manual correction |
| `transfer` | ± | Between locations |

> Stock quantity is protected by DB trigger — cannot be updated directly. Only `apply_stock_movement()` trigger updates it after INSERT on `stock_movements`.

### Overview

| Method | Path | Description |
|---|---|---|
| GET | `/overview` | Inventory summary (total products, value, low stock count) |
| GET | `/low-stock` | List products at or below reorder threshold |

---

## Task Allocation API

Base path: `/api/businesses/:businessId/tasks`

### Team Members

| Method | Path | Description |
|---|---|---|
| POST | `/team-members` | Create a team member |
| GET | `/team-members` | List members (search, availability filter) |
| GET | `/team-members/:memberId` | Get member detail (with skills) |
| PATCH | `/team-members/:memberId` | Update member |
| GET | `/team-members/:memberId/skills` | List member's skills |
| POST | `/team-members/:memberId/skills` | Add a skill (idempotent) |
| DELETE | `/team-members/:memberId/skills/:skillName` | Remove a skill |

### Tasks

| Method | Path | Description |
|---|---|---|
| POST | `/tasks` | Create a task |
| GET | `/tasks` | List tasks (status, priority, assignee, overdue filters) |
| GET | `/tasks/:taskId` | Get task detail (with COALESCE assignments) |
| PATCH | `/tasks/:taskId` | Update task |
| PATCH | `/tasks/:taskId/status` | Update task status |
| DELETE | `/tasks/:taskId` | Delete task (CASCADE to assignments) |

**Task statuses:** `pending` → `in_progress` → `completed` | `cancelled` (can transition from any non-terminal state)

**Task priorities:** `low`, `medium`, `high`, `urgent`

**Protected fields on PATCH:** `business_id`, `status`, `source`, `agent_run_id`

### Assignments

| Method | Path | Description |
|---|---|---|
| POST | `/tasks/:taskId/assignments` | Create assignment (transactional, row locking) |
| GET | `/tasks/:taskId/assignments` | List assignments for a task |
| PATCH | `/assignments/:assignmentId` | Update assignment status |
| DELETE | `/assignments/:assignmentId` | Delete assignment |

**Assignment statuses:** `active` → `completed` | `reassigned` (only `active` can be changed)

> Partial unique index prevents duplicate active assignments for the same (task_id, employee_id).

### Overview

| Method | Path | Description |
|---|---|---|
| GET | `/overview` | Task summary (counts by status, priority, overdue) |
| GET | `/team-members/:memberId/workload` | Member workload (total hours, utilization, breakdown) |

---

## Marketing & Pitch Deck API

Base path: `/api/businesses/:businessId/marketing`

### Marketing Projects

| Method | Path | Description |
|---|---|---|
| POST | `/projects` | Create a project |
| GET | `/projects` | List projects (search, status filter, pagination) |
| GET | `/projects/:projectId` | Get project detail (personas, drafts, pitch decks) |
| PATCH | `/projects/:projectId` | Update project |
| PATCH | `/projects/:projectId/status` | Update project status |
| DELETE | `/projects/:projectId` | Delete project (blocks if children linked) |

**Project statuses:** `draft` → `active` → `completed`

**Protected fields on PATCH:** `business_id`, `status`

**Delete safety:** Blocks if linked personas, drafts, or pitch decks exist.

### Customer Personas

| Method | Path | Description |
|---|---|---|
| POST | `/personas` | Create a persona |
| POST | `/personas/generate` | AI-generate a persona (demo fallback) |
| GET | `/personas` | List personas (search, pagination) |
| GET | `/personas/:personaId` | Get persona detail (with project_name) |
| PATCH | `/personas/:personaId` | Update persona |
| DELETE | `/personas/:personaId` | Delete persona |

**Protected fields on PATCH:** `business_id`, `marketing_project_id`

### Marketing Drafts

| Method | Path | Description |
|---|---|---|
| POST | `/projects/:projectId/drafts` | Create a draft |
| POST | `/projects/:projectId/drafts/generate` | AI-generate a draft (demo fallback) |
| GET | `/projects/:projectId/drafts` | List drafts for a project (status filter) |
| GET | `/drafts/:draftId` | Get draft detail (with project_name) |
| PATCH | `/drafts/:draftId` | Edit draft |
| PATCH | `/drafts/:draftId/status` | Update draft status |
| POST | `/drafts/:draftId/revise` | AI-revise draft content (demo fallback) |
| DELETE | `/drafts/:draftId` | Delete draft |

**Draft types:** `social_media`, `campaign`, `content`, `email`

**Draft statuses:** `draft` → `reviewed` → `approved` → `published`

**Protected fields on PATCH:** `business_id`, `marketing_project_id`, `draft_type`, `status`

### Pitch Decks

| Method | Path | Description |
|---|---|---|
| POST | `/projects/:projectId/pitch-decks` | Create a pitch deck |
| POST | `/projects/:projectId/pitch-decks/generate` | AI-generate a pitch deck (demo fallback, 10 slides) |
| GET | `/projects/:projectId/pitch-decks` | List pitch decks for a project |
| GET | `/pitch-decks/:pitchDeckId` | Get pitch deck detail |
| PATCH | `/pitch-decks/:pitchDeckId` | Update pitch deck |
| PATCH | `/pitch-decks/:pitchDeckId/status` | Update pitch deck status |
| POST | `/pitch-decks/:pitchDeckId/revise` | AI-revise pitch deck (demo fallback) |
| DELETE | `/pitch-decks/:pitchDeckId` | Delete pitch deck |

**Pitch deck statuses:** `draft` → `reviewed` → `finalized`

**Protected fields on PATCH:** `business_id`, `marketing_project_id`, `status`

**Slide schema (JSONB array):**
```json
[
  {
    "slide_number": 1,
    "heading": "Title Slide",
    "bullet_points": ["Business Name"],
    "speaker_notes": "Welcome and introduction"
  }
]
```

> Pitch decks are linked to projects via nullable `marketing_project_id` FK (migration 008). Project-scoped listing filters by this column. Unlinked decks (NULL) are not returned in project listings.

### Overview

| Method | Path | Description |
|---|---|---|
| GET | `/overview` | Marketing summary (counts by status for all resource types) |

### AI Generation Notes

All AI generation endpoints use a deterministic demo fallback:
- `getGeneratorInfo()` returns `{ provider: 'demo', note: '...' }`
- Generated content is labelled `[Demo]`
- No AI model is called
- Responses include `_generator` metadata field

---

## Error Responses

### Standard Error Format

```json
{
  "error": "Error message",
  "details": { "errors": [{ "field": "name", "message": "..." }] }
}
```

### HTTP Status Codes

| Code | Meaning | When |
|---|---|---|
| 200 | OK | Successful GET, PATCH |
| 201 | Created | Successful POST (create) |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Validation failure, invalid UUID, invalid status transition |
| 401 | Unauthorized | Missing or invalid JWT |
| 403 | Forbidden | User is not a member of the business |
| 404 | Not Found | Resource doesn't exist or belongs to another business |
| 409 | Conflict | Unique constraint violation (PostgreSQL error 23505) |

### PostgreSQL Error Code Mapping

| PG Code | HTTP Status | Description |
|---|---|---|
| 23505 | 409 | Unique violation (duplicate key) |
| 23503 | 400 | Foreign key violation |
| 23514 | 400 | Check constraint violation |
| 42725 | 500 | Operator ambiguity (needs `::numeric` cast) |
| 42702 | 500 | Column reference ambiguous (needs table qualifier) |

---

## Status Transition Maps

### Financial

```
Invoices:   draft ---> unpaid ---> overdue (manual, bidirectional unpaid<->overdue)
                              |
                    partially_paid <--- payment
                              |
                           paid (terminal)

             partially_paid and paid are payment-driven -- cannot be set via PATCH
```

### Tasks

```
Tasks:        pending ---> in_progress ---> completed (terminal)
                  |              |
                  +--------------+--> cancelled (terminal, from any non-terminal)

Assignments:  active ---> completed (terminal)
              active ---> reassigned (terminal)
```

### Marketing

```
Projects:    draft ---> active ---> completed (terminal)

Drafts:      draft ---> reviewed ---> approved ---> published (terminal)

Pitch Decks: draft ---> reviewed ---> finalized (terminal)
```

All marketing transitions are forward-only. Attempting to transition to the same status returns a `400` ("already in 'X' status"). Attempting an invalid transition returns a `400` with the allowed transitions listed.

---

## Cross-Business Security

All business-scoped endpoints enforce:
1. **JWT authentication** — `authenticateToken` middleware
2. **Business membership** — `requireBusinessAccess` middleware checks `business_memberships` table
3. **Query-level filtering** — every SQL query includes `WHERE business_id = $X`
4. **Nested resource verification** — before using a nested resource ID (e.g., `projectId` in `/projects/:projectId/drafts`), the route verifies the parent belongs to the business
5. **403 for non-members** — prevents information leakage (not 404)
6. **404 for cross-business access** — resources belonging to another business return 404 (not 403) since the user IS authenticated but the resource "doesn't exist" from their perspective

---

## Concurrency Control

`SELECT FOR UPDATE` row locking is used in:
- **Payment processing** — locks invoice row to prevent concurrent overpayment
- **Stock movements** — locks product row to serialize concurrent movements
- **Task assignment creation** — locks both task and employee rows
- **Task assignment updates** — locks both task and assignment rows

All lock queries include `WHERE business_id = $X` to ensure business-scoped locking.

---

## Limitations & Known Issues

1. **Payment listing response** — returns `{ data: [], count: n }` instead of the standard `{ data: [], pagination: {...} }` format used by all other list endpoints.
2. **Helper function duplication** — `UUID_RE`, `parsePagination`, `requireUUID`, `formatZodError` are duplicated across all 5 route files. Acceptable for hackathon; should be refactored to a shared utils module.
3. **AI generation** — All AI endpoints use deterministic demo fallback. No actual AI model is called. All generated content is labelled `[Demo]`.
4. **Agent integration** — `agent_runs` table and related infrastructure exist in schema but are not yet wired to any route handler. Agent integration is a future phase.
5. **Rate limiting** — In-memory store (single-server). Redis needed for multi-server deployments.
6. **No WebSocket/SSE** — All endpoints are request-response. Real-time updates would require WebSocket infrastructure.
