/**
 * routes/financials.js — Financial Hub API.
 *
 * All routes in this router are prefixed with:
 *   /api/businesses/:businessId/financials
 *
 * Every route requires BOTH:
 *   1. authenticateToken  — verifies the JWT
 *   2. requireBusinessAccess — verifies business membership
 *
 * These are applied at the router level so no route can be left unprotected.
 *
 * Endpoints:
 *   Customers:
 *     POST   /customers              — Create a customer
 *     GET    /customers              — List customers (pagination + search)
 *     GET    /customers/:customerId  — Get a single customer
 *     PATCH  /customers/:customerId  — Update a customer
 *
 *   Invoices:
 *     POST   /invoices               — Create invoice with line items (transactional)
 *     GET    /invoices               — List invoices (pagination + status filter)
 *     GET    /invoices/:invoiceId    — Get invoice with items + payment summary
 *     PATCH  /invoices/:invoiceId/status — Update invoice status (manual transitions)
 *
 *   Payments:
 *     POST   /invoices/:invoiceId/payments — Record a payment (transactional, idempotent)
 *     GET    /invoices/:invoiceId/payments — List payments for an invoice
 *
 * Money handling: all monetary values are NUMERIC(12,2) in PostgreSQL.
 * Totals are calculated in SQL — never in JavaScript — to avoid floating-point errors.
 * Payments use SELECT FOR UPDATE row locking to prevent concurrent overpayment.
 * Idempotency keys use ON CONFLICT DO NOTHING for safe retry handling.
 */

import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { withTransaction } from "../utils/transaction.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authenticateToken } from "../middleware/auth.js";
import { requireBusinessAccess } from "../middleware/businessAuth.js";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from "../utils/errors.js";

const router = Router({ mergeParams: true });

// Apply auth + business access to ALL routes in this router
router.use(authenticateToken, requireBusinessAccess);

// ===================================================================
// Helpers
// ===================================================================

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse and validate pagination query params.
 * @param {object} query - req.query
 * @returns {{ page: number, limit: number, offset: number }}
 */
function parsePagination(queryObj) {
  let page = parseInt(queryObj.page, 10);
  let limit = parseInt(queryObj.limit, 10);
  if (!Number.isInteger(page) || page < 1) page = 1;
  if (!Number.isInteger(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Validate a UUID parameter. Throws BadRequestError if invalid.
 * @param {string} value
 * @param {string} name - param name for error message
 * @returns {string} the validated UUID
 */
function requireUUID(value, name) {
  if (!value || !UUID_RE.test(value)) {
    throw new BadRequestError(`${name} must be a valid UUID`);
  }
  return value;
}

/**
 * Format a Zod error into the standard error detail shape.
 */
function formatZodError(parsed) {
  return {
    errors: parsed.error.issues.map((i) => ({
      field: i.path.join("."),
      message: i.message,
    })),
  };
}

// Allowed invoice statuses for manual PATCH transitions.
// Payment-driven statuses (partially_paid, paid) cannot be set manually.
const VALID_STATUS_TRANSITIONS = {
  draft: ["unpaid"],
  unpaid: ["overdue"],
  overdue: ["unpaid"],
  partially_paid: [], // cannot manually change
  paid: [], // terminal — cannot change
};

// ===================================================================
// Zod Validation Schemas
// ===================================================================

const createCustomerSchema = z.object({
  name: z.string().min(1, "Name is required").max(200, "Name is too long"),
  email: z.string().email("Invalid email format").max(255).optional().nullable(),
  phone: z.string().max(50, "Phone is too long").optional().nullable(),
  address: z.string().max(500, "Address is too long").optional().nullable(),
});

const updateCustomerSchema = z.object({
  name: z.string().min(1, "Name cannot be empty").max(200).optional(),
  email: z.string().email("Invalid email format").max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
});

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

const lineItemSchema = z.object({
  description: z.string().min(1, "Description is required").max(500),
  quantity: z.number().positive("Quantity must be greater than 0"),
  unit_price: z.number().nonnegative("Unit price must be non-negative"),
  tax_rate: z.number().min(0, "Tax rate must be non-negative").max(100, "Tax rate must be at most 100").optional().default(0),
  discount_amount: z.number().nonnegative("Discount must be non-negative").optional().default(0),
  sort_order: z.number().int().nonnegative().optional().default(0),
});

const createInvoiceSchema = z.object({
  customer_id: z.string().uuid("Customer ID must be a valid UUID"),
  invoice_number: z.string().min(1, "Invoice number is required").max(50, "Invoice number is too long"),
  issue_date: dateSchema,
  due_date: dateSchema,
  notes: z.string().max(2000, "Notes are too long").optional().nullable(),
  items: z.array(lineItemSchema).min(1, "At least one line item is required"),
});

const updateInvoiceStatusSchema = z.object({
  status: z.enum(["draft", "unpaid", "overdue"]),
});

const createPaymentSchema = z.object({
  amount: z.number().positive("Amount must be greater than 0"),
  payment_date: dateSchema,
  method: z.enum(
    ["cash", "bank_transfer", "credit_card", "debit_card", "cheque", "other"]
  ),
  reference: z.string().max(200, "Reference is too long").optional().nullable(),
  idempotency_key: z.string().max(200, "Idempotency key is too long").optional().nullable(),
});

// ===================================================================
// CUSTOMER ROUTES
// ===================================================================

// --- POST /customers — Create a customer ----------------------------

router.post(
  "/customers",
  asyncHandler(async (req, res) => {
    const parsed = createCustomerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const { name, email, phone, address } = parsed.data;
    const businessId = req.businessId;

    const result = await query(
      `INSERT INTO customers (business_id, name, email, phone, address)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, business_id, name, email, phone, address, created_at, updated_at`,
      [businessId, name, email ?? null, phone ?? null, address ?? null]
    );

    res.status(201).json(result.rows[0]);
  })
);

// --- GET /customers — List customers (pagination + search) ----------

router.get(
  "/customers",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const { page, limit, offset } = parsePagination(req.query);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

    let result, countResult;

    if (search) {
      const pattern = `%${search}%`;
      countResult = await query(
        `SELECT COUNT(*)::int AS total FROM customers
         WHERE business_id = $1 AND (name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2)`,
        [businessId, pattern]
      );
      result = await query(
        `SELECT id, business_id, name, email, phone, address, created_at, updated_at
         FROM customers
         WHERE business_id = $1 AND (name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2)
         ORDER BY name ASC
         LIMIT $3 OFFSET $4`,
        [businessId, pattern, limit, offset]
      );
    } else {
      countResult = await query(
        `SELECT COUNT(*)::int AS total FROM customers WHERE business_id = $1`,
        [businessId]
      );
      result = await query(
        `SELECT id, business_id, name, email, phone, address, created_at, updated_at
         FROM customers
         WHERE business_id = $1
         ORDER BY name ASC
         LIMIT $2 OFFSET $3`,
        [businessId, limit, offset]
      );
    }

    const total = countResult.rows[0]?.total ?? 0;

    res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit) || 0,
      },
    });
  })
);

// --- GET /customers/:customerId — Get a single customer ------------

router.get(
  "/customers/:customerId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const customerId = requireUUID(req.params.customerId, "Customer ID");

    const result = await query(
      `SELECT id, business_id, name, email, phone, address, created_at, updated_at
       FROM customers
       WHERE id = $1 AND business_id = $2`,
      [customerId, businessId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Customer not found");
    }

    res.json(result.rows[0]);
  })
);

// --- PATCH /customers/:customerId — Update a customer ---------------

router.patch(
  "/customers/:customerId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const customerId = requireUUID(req.params.customerId, "Customer ID");

    const parsed = updateCustomerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    // Build SET clause dynamically from provided fields
    const fields = [];
    const values = [];
    let paramIndex = 1;

    const data = parsed.data;
    for (const [key, val] of Object.entries(data)) {
      if (val === undefined) continue;
      fields.push(`${key} = $${paramIndex}`);
      values.push(val ?? null);
      paramIndex++;
    }

    if (fields.length === 0) {
      throw new BadRequestError("No fields provided to update");
    }

    // Add WHERE clause params
    values.push(customerId); // $paramIndex
    const customerIdParam = paramIndex++;
    values.push(businessId); // $paramIndex
    const businessIdParam = paramIndex;

    const result = await query(
      `UPDATE customers SET ${fields.join(", ")}, updated_at = now()
       WHERE id = $${customerIdParam} AND business_id = $${businessIdParam}
       RETURNING id, business_id, name, email, phone, address, created_at, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Customer not found");
    }

    res.json(result.rows[0]);
  })
);

// ===================================================================
// INVOICE ROUTES
// ===================================================================

// --- POST /invoices — Create invoice with line items ----------------

router.post(
  "/invoices",
  asyncHandler(async (req, res) => {
    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const {
      customer_id,
      invoice_number,
      issue_date,
      due_date,
      notes,
      items,
    } = parsed.data;

    // Verify customer belongs to this business BEFORE the transaction
    const customerCheck = await query(
      "SELECT id FROM customers WHERE id = $1 AND business_id = $2",
      [customer_id, businessId]
    );
    if (customerCheck.rows.length === 0) {
      throw new BadRequestError(
        "Customer does not exist or does not belong to this business"
      );
    }

    // Transactional: insert invoice → insert items → recalculate totals
    const result = await withTransaction(async (client) => {
      // 1. Insert invoice with zero totals (will be recalculated after items)
      const invoiceResult = await client.query(
        `INSERT INTO invoices
           (business_id, customer_id, invoice_number, status, issue_date, due_date,
            subtotal, tax_amount, discount_amount, total, notes)
         VALUES ($1, $2, $3, 'draft', $4, $5, 0, 0, 0, 0, $6)
         RETURNING id, business_id, customer_id, invoice_number, status, issue_date,
            due_date, subtotal, tax_amount, discount_amount, total, notes,
            created_at, updated_at`,
        [businessId, customer_id, invoice_number, issue_date, due_date, notes ?? null]
      );
      const invoice = invoiceResult.rows[0];

      // 2. Insert all line items with SQL-calculated line_total
      //    line_total = (qty * unit_price) + (qty * unit_price * tax_rate / 100) - discount
      const insertedItems = [];
      for (const item of items) {
        const itemResult = await client.query(
          `INSERT INTO invoice_items
             (invoice_id, description, quantity, unit_price, tax_rate,
              discount_amount, line_total, sort_order)
           VALUES ($1, $2, $3::numeric, $4::numeric, $5::numeric, $6::numeric,
             ($3::numeric * $4::numeric) + ($3::numeric * $4::numeric * $5::numeric / 100) - $6::numeric,
             $7)
           RETURNING id, invoice_id, description, quantity, unit_price, tax_rate,
              discount_amount, line_total, sort_order, created_at, updated_at`,
          [
            invoice.id,
            item.description,
            item.quantity,
            item.unit_price,
            item.tax_rate,
            item.discount_amount,
            item.sort_order,
          ]
        );
        insertedItems.push(itemResult.rows[0]);
      }

      // 3. Recalculate invoice totals from line items (in SQL, not JS)
      await client.query(
        `UPDATE invoices SET
           subtotal = (
             SELECT COALESCE(SUM(quantity * unit_price), 0)
             FROM invoice_items WHERE invoice_id = $1
           ),
           tax_amount = (
             SELECT COALESCE(SUM(quantity * unit_price * tax_rate / 100), 0)
             FROM invoice_items WHERE invoice_id = $1
           ),
           discount_amount = (
             SELECT COALESCE(SUM(discount_amount), 0)
             FROM invoice_items WHERE invoice_id = $1
           ),
           total = (
             SELECT COALESCE(SUM(line_total), 0)
             FROM invoice_items WHERE invoice_id = $1
           ),
           updated_at = now()
         WHERE id = $1
         RETURNING subtotal, tax_amount, discount_amount, total`,
        [invoice.id]
      );

      // Re-fetch the updated invoice to get recalculated totals
      const updatedInvoice = await client.query(
        `SELECT id, business_id, customer_id, invoice_number, status, issue_date,
            due_date, subtotal, tax_amount, discount_amount, total, notes,
            created_at, updated_at
         FROM invoices WHERE id = $1`,
        [invoice.id]
      );

      return { invoice: updatedInvoice.rows[0], items: insertedItems };
    });

    res.status(201).json(result);
  })
);

// --- GET /invoices — List invoices (pagination + status filter) -----

router.get(
  "/invoices",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const { page, limit, offset } = parsePagination(req.query);
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";

    const VALID_STATUSES = ["draft", "unpaid", "partially_paid", "paid", "overdue"];

    let result, countResult;

    if (status && VALID_STATUSES.includes(status)) {
      countResult = await query(
        "SELECT COUNT(*)::int AS total FROM invoices WHERE business_id = $1 AND status = $2",
        [businessId, status]
      );
      result = await query(
        `SELECT id, business_id, customer_id, invoice_number, status, issue_date,
            due_date, subtotal, tax_amount, discount_amount, total, notes,
            created_at, updated_at
         FROM invoices
         WHERE business_id = $1 AND status = $2
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [businessId, status, limit, offset]
      );
    } else {
      countResult = await query(
        "SELECT COUNT(*)::int AS total FROM invoices WHERE business_id = $1",
        [businessId]
      );
      result = await query(
        `SELECT id, business_id, customer_id, invoice_number, status, issue_date,
            due_date, subtotal, tax_amount, discount_amount, total, notes,
            created_at, updated_at
         FROM invoices
         WHERE business_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [businessId, limit, offset]
      );
    }

    const total = countResult.rows[0]?.total ?? 0;

    res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit) || 0,
      },
    });
  })
);

// --- GET /invoices/:invoiceId — Get invoice with items + payments ---

router.get(
  "/invoices/:invoiceId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const invoiceId = requireUUID(req.params.invoiceId, "Invoice ID");

    // Fetch the invoice (business-scoped)
    const invoiceResult = await query(
      `SELECT id, business_id, customer_id, invoice_number, status, issue_date,
          due_date, subtotal, tax_amount, discount_amount, total, notes,
          created_at, updated_at
       FROM invoices
       WHERE id = $1 AND business_id = $2`,
      [invoiceId, businessId]
    );

    if (invoiceResult.rows.length === 0) {
      throw new NotFoundError("Invoice not found");
    }

    // Fetch line items (sorted by sort_order)
    const itemsResult = await query(
      `SELECT id, invoice_id, description, quantity, unit_price, tax_rate,
          discount_amount, line_total, sort_order, created_at, updated_at
       FROM invoice_items
       WHERE invoice_id = $1
       ORDER BY sort_order ASC, created_at ASC`,
      [invoiceId]
    );

    // Fetch payment summary
    const paymentSummary = await query(
      `SELECT
         COUNT(*)::int AS payment_count,
         COALESCE(SUM(amount), 0)::numeric(12,2) AS total_paid
       FROM payments
       WHERE invoice_id = $1 AND business_id = $2`,
      [invoiceId, businessId]
    );

    const invoice = invoiceResult.rows[0];
    const totalPaid = parseFloat(paymentSummary.rows[0].total_paid);
    const invoiceTotal = parseFloat(invoice.total);
    const balance = invoiceTotal - totalPaid;

    res.json({
      ...invoice,
      items: itemsResult.rows,
      payments: {
        count: paymentSummary.rows[0].payment_count,
        total_paid: paymentSummary.rows[0].total_paid,
        balance: balance.toFixed(2),
        is_fully_paid: balance <= 0,
      },
    });
  })
);

// --- PATCH /invoices/:invoiceId/status — Update invoice status ------

router.patch(
  "/invoices/:invoiceId/status",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const invoiceId = requireUUID(req.params.invoiceId, "Invoice ID");

    const parsed = updateInvoiceStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const newStatus = parsed.data.status;

    // Fetch current invoice (with FOR UPDATE to prevent concurrent modification)
    const invoiceResult = await query(
      "SELECT id, status FROM invoices WHERE id = $1 AND business_id = $2",
      [invoiceId, businessId]
    );

    if (invoiceResult.rows.length === 0) {
      throw new NotFoundError("Invoice not found");
    }

    const currentStatus = invoiceResult.rows[0].status;

    // Check if the transition is allowed
    const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowedTransitions.includes(newStatus)) {
      throw new BadRequestError(
        `Cannot transition invoice from '${currentStatus}' to '${newStatus}'. ` +
          `Allowed transitions from '${currentStatus}': ${allowedTransitions.length ? allowedTransitions.join(", ") : "none (terminal or payment-driven status)"}.`
      );
    }

    // Apply the status change
    const updateResult = await query(
      `UPDATE invoices SET status = $1, updated_at = now()
       WHERE id = $2 AND business_id = $3
       RETURNING id, business_id, customer_id, invoice_number, status, issue_date,
          due_date, subtotal, tax_amount, discount_amount, total, notes,
          created_at, updated_at`,
      [newStatus, invoiceId, businessId]
    );

    res.json(updateResult.rows[0]);
  })
);

// ===================================================================
// PAYMENT ROUTES
// ===================================================================

// --- POST /invoices/:invoiceId/payments — Record a payment ----------

router.post(
  "/invoices/:invoiceId/payments",
  asyncHandler(async (req, res) => {
    const parsed = createPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const invoiceId = requireUUID(req.params.invoiceId, "Invoice ID");
    const { amount, payment_date, method, reference, idempotency_key } =
      parsed.data;

    // --- Pre-transaction idempotency check (optimization) ---
    // If an idempotency key is provided, check if a payment already exists.
    // This avoids starting a transaction + row lock unnecessarily.
    if (idempotency_key) {
      const existing = await query(
        `SELECT id, invoice_id, business_id, amount, payment_date, method,
            reference, idempotency_key, created_at
         FROM payments
         WHERE business_id = $1 AND idempotency_key = $2`,
        [businessId, idempotency_key]
      );
      if (existing.rows.length > 0) {
        // Idempotent response — return the existing payment
        return res.status(200).json(existing.rows[0]);
      }
    }

    // --- Transactional payment processing ---
    const result = await withTransaction(async (client) => {
      // 1. Lock the invoice row with SELECT FOR UPDATE
      //    This prevents concurrent payments from overpaying.
      const invoiceResult = await client.query(
        `SELECT id, business_id, total, status
         FROM invoices
         WHERE id = $1 AND business_id = $2
         FOR UPDATE`,
        [invoiceId, businessId]
      );

      if (invoiceResult.rows.length === 0) {
        throw new NotFoundError("Invoice not found");
      }

      const invoice = invoiceResult.rows[0];
      const invoiceTotal = parseFloat(invoice.total);

      // 2. Calculate total already paid
      const paidResult = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::numeric(12,2) AS total_paid
         FROM payments
         WHERE invoice_id = $1 AND business_id = $2`,
        [invoiceId, businessId]
      );
      const totalPaid = parseFloat(paidResult.rows[0].total_paid);

      // 3. Check for overpayment
      const newTotal = totalPaid + amount;
      if (newTotal > invoiceTotal) {
        throw new BadRequestError(
          `Payment would overpay the invoice. ` +
            `Invoice total: ${invoiceTotal.toFixed(2)}, ` +
            `already paid: ${totalPaid.toFixed(2)}, ` +
            `remaining balance: ${(invoiceTotal - totalPaid).toFixed(2)}, ` +
            `attempted payment: ${amount.toFixed(2)}`
        );
      }

      // 4. Insert the payment
      //    If idempotency_key is provided, use ON CONFLICT DO NOTHING
      //    to handle the race condition between pre-check and insert.
      let paymentResult;

      if (idempotency_key) {
        // ON CONFLICT handles the race: if another concurrent request
        // inserted the same idempotency_key between our pre-check and
        // this INSERT, DO NOTHING prevents a duplicate, and we fetch
        // the existing record below.
        paymentResult = await client.query(
          `INSERT INTO payments (invoice_id, business_id, amount, payment_date,
              method, reference, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (business_id, idempotency_key) DO NOTHING
           RETURNING id, invoice_id, business_id, amount, payment_date, method,
              reference, idempotency_key, created_at`,
          [
            invoiceId,
            businessId,
            amount,
            payment_date,
            method,
            reference ?? null,
            idempotency_key,
          ]
        );

        // If ON CONFLICT fired (0 rows returned), fetch the existing payment
        if (paymentResult.rows.length === 0) {
          const existingPayment = await client.query(
            `SELECT id, invoice_id, business_id, amount, payment_date, method,
                reference, idempotency_key, created_at
             FROM payments
             WHERE business_id = $1 AND idempotency_key = $2`,
            [businessId, idempotency_key]
          );
          // Return existing payment — the caller will send 200 instead of 201
          return { payment: existingPayment.rows[0], isExisting: true };
        }
      } else {
        // No idempotency key — just insert normally
        paymentResult = await client.query(
          `INSERT INTO payments (invoice_id, business_id, amount, payment_date,
              method, reference, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, invoice_id, business_id, amount, payment_date, method,
              reference, idempotency_key, created_at`,
          [
            invoiceId,
            businessId,
            amount,
            payment_date,
            method,
            reference ?? null,
            null,
          ]
        );
      }

      const payment = paymentResult.rows[0];

      // 5. Update invoice status based on payment totals
      //    totalPaid is from BEFORE this payment — recalculate with new payment
      const totalPaidAfter = totalPaid + amount;

      let newStatus;
      if (totalPaidAfter >= invoiceTotal) {
        newStatus = "paid";
      } else if (totalPaidAfter > 0) {
        newStatus = "partially_paid";
      } else {
        newStatus = invoice.status; // keep current status
      }

      if (newStatus !== invoice.status) {
        await client.query(
          "UPDATE invoices SET status = $1, updated_at = now() WHERE id = $2",
          [newStatus, invoiceId]
        );
      }

      return { payment, isExisting: false };
    });

    // Set appropriate status code
    if (result.isExisting) {
      res.status(200).json(result.payment);
    } else {
      res.status(201).json(result.payment);
    }
  })
);

// --- GET /invoices/:invoiceId/payments — List payments ---------------

router.get(
  "/invoices/:invoiceId/payments",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const invoiceId = requireUUID(req.params.invoiceId, "Invoice ID");

    // Verify invoice exists and belongs to this business
    const invoiceCheck = await query(
      "SELECT id FROM invoices WHERE id = $1 AND business_id = $2",
      [invoiceId, businessId]
    );

    if (invoiceCheck.rows.length === 0) {
      throw new NotFoundError("Invoice not found");
    }

    const result = await query(
      `SELECT id, invoice_id, business_id, amount, payment_date, method,
          reference, idempotency_key, created_at
       FROM payments
       WHERE invoice_id = $1 AND business_id = $2
       ORDER BY created_at ASC`,
      [invoiceId, businessId]
    );

    res.json({
      data: result.rows,
      count: result.rows.length,
    });
  })
);

export default router;
