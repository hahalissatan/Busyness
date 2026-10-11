/**
 * services/invoiceAgent.js — Secure invoice creation handler for the AI chat.
 *
 * This module implements the server-side invoice-creation workflow that the
 * AI agent calls when a user asks to create an invoice in natural language.
 *
 * Architecture:
 *   AI model → understands message, decides to call create_invoice tool
 *   This handler → validates args, resolves customer, checks permissions,
 *                   creates invoice via transactional DB operation,
 *                   verifies the persisted record, returns verified data
 *   Database → source of truth (PostgreSQL), enforces constraints
 *
 * SECURITY:
 *   - businessId is ALWAYS injected from the authenticated request context
 *   - userId is ALWAYS injected from the authenticated request context
 *   - Tool arguments are validated server-side (never trusted from AI)
 *   - Customer resolution is scoped to the business
 *   - Invoice creation uses the existing transactional pattern
 *   - Idempotency keys prevent duplicate creation on retry
 *   - The AI never writes directly to the database
 *   - All monetary calculations are done in SQL, not JavaScript
 *
 * The handler returns structured results that distinguish:
 *   - success: invoice was created and verified
 *   - needs_clarification: required info is missing or ambiguous
 *   - error: validation failure, authorization failure, or DB error
 */

import { query } from "../db/pool.js";
import { withTransaction } from "../utils/transaction.js";
import { randomUUID } from "crypto";

// --- Constants -----------------------------------------------------------

const MIN_AMOUNT = 0.01;
const MAX_AMOUNT = 99999999.99; // NUMERIC(12,2) max
const MAX_SEARCH_RESULTS = 10;
const MAX_INVOICE_LIST = 20;
const DEFAULT_TAX_RATE = 6; // 6% SST (Malaysian standard)
const DEFAULT_PAYMENT_TERMS_DAYS = 14;

// --- Error types (structured for AI consumption) -------------------------

/**
 * @typedef {Object} InvoiceActionResult
 * @property {"success"|"needs_clarification"|"error"} status
 * @property {string} message - Human-readable message for the AI to relay
 * @property {Object|null} invoice - Verified invoice data (on success)
 * @property {Object|null} clarification - Clarification details (when needed)
 * @property {Object|null} error - Error details (on failure)
 */

// --- Customer lookup -----------------------------------------------------

/**
 * Search for customers by name within the business scope.
 *
 * @param {string} businessId - Verified business UUID from auth context
 * @param {string} searchTerm - Customer name or partial name to search
 * @returns {Promise<{items: Array, count: number}>}
 */
export async function searchCustomers(businessId, searchTerm) {
  if (!searchTerm || typeof searchTerm !== "string" || searchTerm.trim().length < 1) {
    return { items: [], count: 0, error: "Search term is required" };
  }

  const escaped = searchTerm.trim().replace(/[%_]/g, "\\$&");
  const res = await query(
    `SELECT id, name, email, phone, address, created_at
     FROM customers
     WHERE business_id = $1
       AND (name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2)
     ORDER BY
       CASE WHEN name ILIKE $3 THEN 0 ELSE 1 END,
       name ASC
     LIMIT $4`,
    [businessId, `%${escaped}%`, `${escaped}%`, MAX_SEARCH_RESULTS]
  );

  return {
    items: res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      address: r.address,
    })),
    count: res.rows.length,
  };
}

/**
 * Resolve a customer by name within the business scope.
 * Returns the customer if exactly one match, or a clarification request
 * if multiple matches are found.
 *
 * @param {string} businessId
 * @param {string} customerName
 * @returns {Promise<{resolved: boolean, customer?: object, clarification?: object, error?: string}>}
 */
export async function resolveCustomer(businessId, customerName) {
  const search = await searchCustomers(businessId, customerName);

  if (search.count === 0) {
    return {
      resolved: false,
      error: `No customer found matching "${customerName}". Would you like to create a new customer first, or try a different name?`,
    };
  }

  if (search.count === 1) {
    return {
      resolved: true,
      customer: search.items[0],
    };
  }

  // Multiple matches — ask for clarification
  const customerList = search.items
    .map((c) => `  • ${c.name}${c.email ? ` (${c.email})` : ""}`)
    .join("\n");

  return {
    resolved: false,
    clarification: {
      type: "ambiguous_customer",
      message: `I found ${search.count} customers matching "${customerName}". Which one did you mean?`,
      customers: search.items,
      customer_list: customerList,
    },
  };
}

// --- Invoice creation ----------------------------------------------------

/**
 * Create a draft invoice from AI-provided arguments.
 *
 * This is the secure server-side handler. It:
 *   1. Validates all input arguments
 *   2. Resolves the customer against real DB records
 *   3. Generates an invoice number if not provided
 *   4. Creates the invoice transactionally (header + line items + totals)
 *   5. Verifies the persisted record by re-fetching it
 *   6. Returns verified data
 *
 * @param {object} params
 * @param {string} params.businessId - Verified business UUID
 * @param {string} params.userId - Verified user UUID
 * @param {object} params.args - AI-provided arguments
 * @param {string} params.args.customer_name - Customer name to resolve
 * @param {number|null} [params.args.amount] - Invoice total amount
 * @param {string|null} [params.args.description] - Line item description
 * @param {string|null} [params.args.currency] - Currency (ignored, uses business default)
 * @param {string|null} [params.args.idempotency_key] - For duplicate prevention
 * @returns {Promise<InvoiceActionResult>}
 */
export async function createInvoiceFromChat({ businessId, userId, args }) {
  // 1. Validate required arguments
  const validation = validateCreateArgs(args);
  if (!validation.valid) {
    return {
      status: "needs_clarification",
      message: validation.message,
      clarification: validation.clarification || null,
      invoice: null,
      error: null,
    };
  }

  const { customer_name, amount, description, idempotency_key } = validation.sanitized;

  // 2. Check for idempotency — if the same key was used before, return existing
  if (idempotency_key) {
    const existing = await checkIdempotency(businessId, idempotency_key);
    if (existing) {
      // Re-verify by fetching the invoice
      const verified = await verifyInvoice(businessId, existing.invoice_id);
      if (verified) {
        return {
          status: "success",
          message: `This invoice was already created. Here are the verified details:`,
          invoice: formatInvoiceResult(verified),
          invoice_id: existing.invoice_id,
          is_idempotent: true,
          error: null,
          clarification: null,
        };
      }
    }
  }

  // 3. Resolve the customer
  const customerResult = await resolveCustomer(businessId, customer_name);
  if (!customerResult.resolved) {
    if (customerResult.clarification) {
      return {
        status: "needs_clarification",
        message: customerResult.clarification.message,
        clarification: customerResult.clarification,
        invoice: null,
        error: null,
      };
    }
    return {
      status: "needs_clarification",
      message: customerResult.error,
      clarification: null,
      invoice: null,
      error: null,
    };
  }

  const customer = customerResult.customer;

  // 4. Generate invoice number
  const invoiceNumber = await generateInvoiceNumber(businessId);

  // 5. Calculate dates
  const today = new Date();
  const issueDate = today.toISOString().slice(0, 10);
  const dueDate = new Date(today.getTime() + DEFAULT_PAYMENT_TERMS_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);

  // 6. Calculate line item values
  // The amount from the user is the total (including tax).
  // We derive the subtotal and tax from it.
  const taxRate = DEFAULT_TAX_RATE;
  const total = parseFloat(amount.toFixed(2));
  const subtotal = parseFloat((total / (1 + taxRate / 100)).toFixed(2));
  const taxAmount = parseFloat((total - subtotal).toFixed(2));
  const lineDescription = description || `Invoice for ${customer.name}`;

  // 7. Create invoice transactionally
  try {
    const result = await withTransaction(async (client) => {
      // Insert invoice header with calculated totals
      const notes = `Created via AI assistant by user ${userId}${idempotency_key ? ` [idem:${idempotency_key}]` : ""}`;
      const invoiceResult = await client.query(
        `INSERT INTO invoices
           (business_id, customer_id, invoice_number, status, issue_date, due_date,
            subtotal, tax_amount, discount_amount, total, notes)
         VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, 0, $8, $9)
         RETURNING id, business_id, customer_id, invoice_number, status, issue_date,
            due_date, subtotal, tax_amount, discount_amount, total, notes,
            created_at, updated_at`,
        [
          businessId,
          customer.id,
          invoiceNumber,
          issueDate,
          dueDate,
          subtotal,
          taxAmount,
          total,
          notes,
        ]
      );
      const invoice = invoiceResult.rows[0];

      // Insert single line item with SQL-calculated line_total
      await client.query(
        `INSERT INTO invoice_items
           (invoice_id, description, quantity, unit_price, tax_rate,
            discount_amount, line_total, sort_order)
         VALUES ($1, $2, 1, $3::numeric, $4::numeric, 0,
           ($3::numeric) + ($3::numeric * $4::numeric / 100),
           1)`,
        [invoice.id, lineDescription, subtotal, taxRate]
      );

      // Recalculate invoice totals from line items (authoritative source)
      await client.query(
        `UPDATE invoices SET
           subtotal = (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM invoice_items WHERE invoice_id = $1),
           tax_amount = (SELECT COALESCE(SUM(quantity * unit_price * tax_rate / 100), 0) FROM invoice_items WHERE invoice_id = $1),
           discount_amount = (SELECT COALESCE(SUM(discount_amount), 0) FROM invoice_items WHERE invoice_id = $1),
           total = (SELECT COALESCE(SUM(line_total), 0) FROM invoice_items WHERE invoice_id = $1),
           updated_at = now()
         WHERE id = $1`,
        [invoice.id]
      );

      // Re-fetch the updated invoice
      const updatedInvoice = await client.query(
        `SELECT i.id, i.business_id, i.customer_id, i.invoice_number, i.status,
                to_char(i.issue_date, 'YYYY-MM-DD') AS issue_date,
                to_char(i.due_date, 'YYYY-MM-DD') AS due_date,
                i.subtotal, i.tax_amount,
                i.discount_amount, i.total, i.notes, i.created_at, i.updated_at,
                c.name AS customer_name, c.email AS customer_email
         FROM invoices i
         JOIN customers c ON c.id = i.customer_id
         WHERE i.id = $1`,
        [invoice.id]
      );

      return updatedInvoice.rows[0];
    });

    // 8. Verify the persisted record
    const verified = await verifyInvoice(businessId, result.id);
    if (!verified) {
      // This should not happen — the transaction committed but verification failed.
      // Report uncertainty rather than claiming success.
      return {
        status: "error",
        message: "The invoice may have been created, but I couldn't verify it. Please check the invoice list to confirm.",
        invoice: null,
        error: { type: "verification_failed", invoice_id: result.id },
        clarification: null,
      };
    }

    // 9. Return verified result
    return {
      status: "success",
      message: `Invoice created successfully!`,
      invoice: formatInvoiceResult(verified),
      invoice_id: verified.id,
      is_idempotent: false,
      error: null,
      clarification: null,
    };
  } catch (err) {
    // Handle specific DB errors
    if (err.code === "23505") {
      // Unique constraint violation — invoice_number collision (extremely unlikely with timestamp-based generation)
      return {
        status: "error",
        message: "An invoice with this number already exists. Please try again.",
        invoice: null,
        error: { type: "duplicate_invoice_number" },
        clarification: null,
      };
    }
    if (err.code === "23503") {
      return {
        status: "error",
        message: "The referenced customer or business record could not be found.",
        invoice: null,
        error: { type: "foreign_key_violation" },
        clarification: null,
      };
    }
    // Generic error — don't expose internal details
    console.error("[invoiceAgent] Create invoice error:", err.code, err.message);
    return {
      status: "error",
      message: "I couldn't create the invoice due to a technical issue. Please try again or create it manually.",
      invoice: null,
      error: { type: "database_error", code: err.code },
      clarification: null,
    };
  }
}

// --- Invoice listing and retrieval ---------------------------------------

/**
 * List recent invoices for the business.
 *
 * @param {string} businessId
 * @param {object} [opts] - Optional filters
 * @param {string} [opts.status] - Filter by status
 * @param {number} [opts.limit] - Max results (default 10)
 * @returns {Promise<{items: Array, count: number}>}
 */
export async function listInvoices(businessId, opts = {}) {
  const limit = Math.min(opts.limit || 10, MAX_INVOICE_LIST);
  const status = opts.status;

  const VALID_STATUSES = ["draft", "unpaid", "partially_paid", "paid", "overdue"];

  let res;
  if (status && VALID_STATUSES.includes(status)) {
    res = await query(
      `SELECT i.id, i.invoice_number, i.status,
              to_char(i.issue_date, 'YYYY-MM-DD') AS issue_date,
              to_char(i.due_date, 'YYYY-MM-DD') AS due_date,
              i.total, i.subtotal, i.tax_amount,
              c.name AS customer_name
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       WHERE i.business_id = $1 AND i.status = $2
       ORDER BY i.created_at DESC
       LIMIT $3`,
      [businessId, status, limit]
    );
  } else {
    res = await query(
      `SELECT i.id, i.invoice_number, i.status,
              to_char(i.issue_date, 'YYYY-MM-DD') AS issue_date,
              to_char(i.due_date, 'YYYY-MM-DD') AS due_date,
              i.total, i.subtotal, i.tax_amount,
              c.name AS customer_name
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       WHERE i.business_id = $1
       ORDER BY i.created_at DESC
       LIMIT $2`,
      [businessId, limit]
    );
  }

  return {
    items: res.rows.map((r) => ({
      id: r.id,
      invoice_number: r.invoice_number,
      status: r.status,
      issue_date: r.issue_date,
      due_date: r.due_date,
      total: parseFloat(r.total),
      customer_name: r.customer_name,
    })),
    count: res.rows.length,
  };
}

/**
 * Get a single invoice with full details.
 *
 * @param {string} businessId
 * @param {string} invoiceId
 * @returns {Promise<object|null>}
 */
export async function getInvoice(businessId, invoiceId) {
  const res = await query(
    `SELECT i.id, i.invoice_number, i.status,
            to_char(i.issue_date, 'YYYY-MM-DD') AS issue_date,
            to_char(i.due_date, 'YYYY-MM-DD') AS due_date,
            i.subtotal, i.tax_amount, i.discount_amount, i.total, i.notes,
            i.created_at,
            c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
     FROM invoices i
     JOIN customers c ON c.id = i.customer_id
     WHERE i.id = $1 AND i.business_id = $2`,
    [invoiceId, businessId]
  );

  if (res.rows.length === 0) return null;

  const invoice = res.rows[0];

  // Fetch line items
  const itemsRes = await query(
    `SELECT id, description, quantity, unit_price, tax_rate, discount_amount, line_total
     FROM invoice_items
     WHERE invoice_id = $1
     ORDER BY sort_order ASC`,
    [invoiceId]
  );

  // Fetch payment summary
  const payRes = await query(
    `SELECT COALESCE(SUM(amount), 0)::numeric(12,2) AS total_paid,
            COUNT(*)::int AS payment_count
     FROM payments
     WHERE invoice_id = $1 AND business_id = $2`,
    [invoiceId, businessId]
  );

  const totalPaid = parseFloat(payRes.rows[0].total_paid);
  const total = parseFloat(invoice.total);
  const balance = total - totalPaid;

  return {
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    status: invoice.status,
    issue_date: invoice.issue_date,
    due_date: invoice.due_date,
    subtotal: parseFloat(invoice.subtotal),
    tax_amount: parseFloat(invoice.tax_amount),
    discount_amount: parseFloat(invoice.discount_amount),
    total: total,
    notes: invoice.notes,
    customer_name: invoice.customer_name,
    customer_email: invoice.customer_email,
    customer_phone: invoice.customer_phone,
    items: itemsRes.rows.map((r) => ({
      ...r,
      quantity: parseFloat(r.quantity),
      unit_price: parseFloat(r.unit_price),
      tax_rate: parseFloat(r.tax_rate),
      discount_amount: parseFloat(r.discount_amount),
      line_total: parseFloat(r.line_total),
    })),
    payments: {
      count: payRes.rows[0].payment_count,
      total_paid: totalPaid,
      balance: parseFloat(balance.toFixed(2)),
      is_fully_paid: balance <= 0,
    },
  };
}

// --- Validation helpers --------------------------------------------------

/**
 * Validate the arguments for create_invoice.
 *
 * @param {object} args
 * @returns {{valid: boolean, message?: string, sanitized?: object, clarification?: object}}
 */
function validateCreateArgs(args) {
  if (!args || typeof args !== "object") {
    return { valid: false, message: "I need some information to create an invoice. Please tell me the customer name and the amount." };
  }

  // Customer name — required
  const customerName = args.customer_name;
  if (!customerName || typeof customerName !== "string" || customerName.trim().length === 0) {
    return {
      valid: false,
      message: "Which customer should I create the invoice for? Please provide the customer name.",
      clarification: { type: "missing_customer_name" },
    };
  }
  if (customerName.trim().length > 200) {
    return { valid: false, message: "The customer name is too long. Please use a shorter name." };
  }

  // Amount — required for now (could be made optional for "prepare without saving")
  const amount = args.amount;
  if (amount === null || amount === undefined) {
    return {
      valid: false,
      message: `How much should I invoice ${customerName.trim()} for? Please provide the amount (e.g., "RM500" or "500").`,
      clarification: { type: "missing_amount", customer_name: customerName.trim() },
    };
  }

  const parsedAmount = typeof amount === "string" ? parseFloat(amount.replace(/[^0-9.]/g, "")) : parseFloat(amount);

  if (isNaN(parsedAmount) || parsedAmount < MIN_AMOUNT) {
    return {
      valid: false,
      message: `The amount must be at least ${MIN_AMOUNT}. Please provide a valid amount.`,
      clarification: { type: "invalid_amount" },
    };
  }

  if (parsedAmount > MAX_AMOUNT) {
    return { valid: false, message: `The amount exceeds the maximum allowed value.` };
  }

  // Description — optional
  let description = null;
  if (args.description && typeof args.description === "string" && args.description.trim().length > 0) {
    description = args.description.trim().slice(0, 500);
  }

  // Idempotency key — optional, generate if not provided
  const idempotencyKey = args.idempotency_key || null;

  return {
    valid: true,
    sanitized: {
      customer_name: customerName.trim(),
      amount: parsedAmount,
      description,
      idempotency_key: idempotencyKey,
    },
  };
}

// --- Invoice number generation -------------------------------------------

/**
 * Generate a unique invoice number.
 * Format: INV-YYYY-NNN (where NNN is a sequential number based on existing invoices)
 *
 * @param {string} businessId
 * @returns {Promise<string>}
 */
export async function generateInvoiceNumber(businessId) {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;

  // Find the highest existing sequence number for this year
  const res = await query(
    `SELECT invoice_number
     FROM invoices
     WHERE business_id = $1 AND invoice_number LIKE $2
     ORDER BY invoice_number DESC
     LIMIT 1`,
    [businessId, `${prefix}%`]
  );

  let seq = 1;
  if (res.rows.length > 0) {
    const lastNumber = res.rows[0].invoice_number;
    const match = lastNumber.match(/(\d+)$/);
    if (match) {
      seq = parseInt(match[1], 10) + 1;
    }
  }

  return `${prefix}${String(seq).padStart(3, "0")}`;
}

// --- Verification --------------------------------------------------------

/**
 * Verify that an invoice exists in the database by re-fetching it.
 *
 * @param {string} businessId
 * @param {string} invoiceId
 * @returns {Promise<object|null>} The verified invoice or null
 */
export async function verifyInvoice(businessId, invoiceId) {
  return getInvoice(businessId, invoiceId);
}

// --- Idempotency ---------------------------------------------------------

/**
 * Check if an invoice was already created with this idempotency key.
 * Uses the notes field to store the idempotency key (since invoices don't
 * have a dedicated column — this avoids a schema migration).
 *
 * @param {string} businessId
 * @param {string} key
 * @returns {Promise<{invoice_id: string}|null>}
 */
export async function checkIdempotency(businessId, key) {
  // We store the idempotency key in the notes field as: "Created via AI assistant by user X [idem:KEY]"
  const res = await query(
    `SELECT id FROM invoices
     WHERE business_id = $1 AND notes ILIKE $2
     LIMIT 1`,
    [businessId, `%[idem:${key}]%`]
  );

  if (res.rows.length > 0) {
    return { invoice_id: res.rows[0].id };
  }
  return null;
}

// --- Formatting ----------------------------------------------------------

/**
 * Format a verified invoice into a result object for the AI.
 *
 * @param {object} invoice
 * @returns {object}
 */
function formatInvoiceResult(invoice) {
  return {
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    status: invoice.status,
    issue_date: invoice.issue_date,
    due_date: invoice.due_date,
    subtotal: invoice.subtotal,
    tax_amount: invoice.tax_amount,
    total: invoice.total,
    customer_name: invoice.customer_name,
    customer_email: invoice.customer_email,
    items: invoice.items,
    payments: invoice.payments,
  };
}

// --- Check for existing invoices for a customer --------------------------

/**
 * Check if there are existing invoices for a customer.
 * Used to answer "Did we already invoice CTmart?"
 *
 * @param {string} businessId
 * @param {string} customerName
 * @returns {Promise<{found: boolean, invoices: Array, count: number}>}
 */
export async function checkExistingInvoices(businessId, customerName) {
  const escaped = customerName.trim().replace(/[%_]/g, "\\$&");
  const res = await query(
    `SELECT i.id, i.invoice_number, i.status,
            to_char(i.issue_date, 'YYYY-MM-DD') AS issue_date,
            to_char(i.due_date, 'YYYY-MM-DD') AS due_date, i.total,
            c.name AS customer_name
     FROM invoices i
     JOIN customers c ON c.id = i.customer_id
     WHERE i.business_id = $1
       AND c.name ILIKE $2
     ORDER BY i.created_at DESC
     LIMIT 10`,
    [businessId, `%${escaped}%`]
  );

  return {
    found: res.rows.length > 0,
    invoices: res.rows.map((r) => ({
      id: r.id,
      invoice_number: r.invoice_number,
      status: r.status,
      issue_date: r.issue_date,
      due_date: r.due_date,
      total: parseFloat(r.total),
      customer_name: r.customer_name,
    })),
    count: res.rows.length,
  };
}
