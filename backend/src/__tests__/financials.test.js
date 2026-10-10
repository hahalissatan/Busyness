/**
 * financials.test.js — Integration tests for the Financial Hub API.
 *
 * Covers:
 *   1. Customer CRUD (create, list, get, update)
 *   2. Invoice CRUD with line items + SQL-calculated totals
 *   3. Invoice status transitions (manual only)
 *   4. Payment recording (transactional, idempotent, overpayment prevention)
 *   5. Payment listing
 *   6. Auth/security (no token, wrong business, non-UUID params)
 *   7. Regression (health checks still work)
 *
 * Tests run against the real Supabase PostgreSQL database.
 * All test data is cleaned up in the afterAll hook (FK-safe order).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app.js";
import { query, closePool } from "../db/pool.js";

// --- Track test data for cleanup ---
const testUserEmails = [];
const testBusinessIds = [];

// Unique suffix to avoid collisions across test runs
const ts = Date.now();

// Shared test state
let token = "";
let businessId = "";
let customerId = "";
let customerId2 = "";
let invoiceId = "";
let paidInvoiceId = "";

// Counter for unique invoice numbers
let invCounter = 0;
function nextInvoiceNumber() {
  invCounter++;
  return `INV-${ts}-${invCounter}`;
}

// --- Helper: register a user and return token + businessId ---
async function setupUser() {
  const email = `fin-test-${ts}@busyness.test`;
  const res = await request(app).post("/api/auth/register").send({
    email,
    password: "SecurePass123!",
    name: "Financial Test User",
    business_name: `Financial Test Biz ${ts}`,
  });
  testUserEmails.push(email);
  if (res.body.business?.id) testBusinessIds.push(res.body.business.id);
  return { token: res.body.token, businessId: res.body.business.id };
}

// --- Helper: create a customer via API ---
async function createCustomer(name, email, phone, address) {
  const res = await request(app)
    .post(`/api/businesses/${businessId}/financials/customers`)
    .set("Authorization", `Bearer ${token}`)
    .send({ name, email, phone, address });
  return res;
}

// --- Helper: create an invoice via API ---
async function createInvoice(customerIdVal, items, opts = {}) {
  const body = {
    customer_id: customerIdVal,
    invoice_number: nextInvoiceNumber(),
    issue_date: "2026-01-01",
    due_date: "2026-02-01",
    items,
  };
  if (opts.notes !== undefined) body.notes = opts.notes;
  const res = await request(app)
    .post(`/api/businesses/${businessId}/financials/invoices`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
  return res;
}

/**
 * Clean up all test data. FK-safe order:
 *   payments → invoices (cascade items) → customers → memberships → users → businesses
 */
afterAll(async () => {
  for (const bid of testBusinessIds) {
    try {
      await query("DELETE FROM payments WHERE business_id = $1", [bid]);
    } catch {}
    try {
      await query("DELETE FROM invoices WHERE business_id = $1", [bid]);
    } catch {}
    try {
      await query("DELETE FROM customers WHERE business_id = $1", [bid]);
    } catch {}
    try {
      await query("DELETE FROM business_memberships WHERE business_id = $1", [bid]);
    } catch {}
    try {
      await query("DELETE FROM businesses WHERE id = $1", [bid]);
    } catch {}
  }
  for (const email of testUserEmails) {
    try {
      await query("DELETE FROM users WHERE email = $1", [email]);
    } catch {}
  }
  await closePool();
}, 30000);

// ===================================================================
// Setup: Register a user and business
// ===================================================================

beforeAll(async () => {
  const setup = await setupUser();
  token = setup.token;
  businessId = setup.businessId;
});

// ===================================================================
// Customer CRUD Tests
// ===================================================================

describe("Customer CRUD", () => {
  it("should create a customer with all fields (201)", async () => {
    const res = await createCustomer(
      "Alice Wong",
      "alice@example.com",
      "+60123456789",
      "123 Jalan Test, Kuala Lumpur"
    );

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe("Alice Wong");
    expect(res.body.email).toBe("alice@example.com");
    expect(res.body.phone).toBe("+60123456789");
    expect(res.body.address).toBe("123 Jalan Test, Kuala Lumpur");
    expect(res.body.business_id).toBe(businessId);

    customerId = res.body.id;
  });

  it("should create a customer with only name (201)", async () => {
    const res = await createCustomer("Bob Tan");

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Bob Tan");
    expect(res.body.email).toBeNull();
    expect(res.body.phone).toBeNull();
    expect(res.body.address).toBeNull();

    customerId2 = res.body.id;
  });

  it("should reject customer creation with missing name (400)", async () => {
    const res = await createCustomer(null, "test@example.com");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });

  it("should reject customer creation with invalid email (400)", async () => {
    const res = await createCustomer("Test User", "not-an-email");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });

  it("should list customers with pagination (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/financials/customers?page=1&limit=10`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.pagination).toHaveProperty("page", 1);
    expect(res.body.pagination).toHaveProperty("limit", 10);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(2);
  });

  it("should search customers by name (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/financials/customers?search=Alice`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].name).toContain("Alice");
  });

  it("should search customers by email (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/financials/customers?search=alice@example`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].email).toBe("alice@example.com");
  });

  it("should get a single customer by ID (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/financials/customers/${customerId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(customerId);
    expect(res.body.name).toBe("Alice Wong");
  });

  it("should return 404 for non-existent customer", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .get(`/api/businesses/${businessId}/financials/customers/${fakeId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("should return 400 for non-UUID customer ID", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/financials/customers/not-a-uuid`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uuid/i);
  });

  it("should update a customer (200)", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/financials/customers/${customerId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Alice Wong Updated",
        phone: "+60987654321",
      });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Alice Wong Updated");
    expect(res.body.phone).toBe("+60987654321");
    // Email and address should be unchanged
    expect(res.body.email).toBe("alice@example.com");
  });

  it("should return 404 when updating non-existent customer", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/financials/customers/${fakeId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Ghost" });

    expect(res.status).toBe(404);
  });

  it("should return 400 when updating with no fields", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/financials/customers/${customerId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no fields/i);
  });
});

// ===================================================================
// Invoice CRUD Tests
// ===================================================================

describe("Invoice CRUD", () => {
  it("should create an invoice with line items and SQL-calculated totals (201)", async () => {
    const res = await createInvoice(customerId, [
      {
        description: "Web design service",
        quantity: 2,
        unit_price: 50.0,
        tax_rate: 10,
        discount_amount: 0,
      },
      {
        description: "Hosting setup",
        quantity: 1,
        unit_price: 100.0,
        tax_rate: 0,
        discount_amount: 10.0,
      },
    ]);

    expect(res.status).toBe(201);
    expect(res.body.invoice.id).toBeTruthy();
    expect(res.body.invoice.status).toBe("draft");
    expect(res.body.invoice.invoice_number).toBeTruthy();

    // Verify SQL-calculated totals
    // Item 1: (2*50) + (2*50*10/100) - 0 = 100 + 10 = 110.00
    // Item 2: (1*100) + 0 - 10 = 90.00
    // subtotal = 200.00, tax = 10.00, discount = 10.00, total = 200.00
    expect(parseFloat(res.body.invoice.subtotal)).toBe(200.0);
    expect(parseFloat(res.body.invoice.tax_amount)).toBe(10.0);
    expect(parseFloat(res.body.invoice.discount_amount)).toBe(10.0);
    expect(parseFloat(res.body.invoice.total)).toBe(200.0);

    // Verify line items
    expect(res.body.items).toHaveLength(2);
    expect(parseFloat(res.body.items[0].line_total)).toBe(110.0);
    expect(parseFloat(res.body.items[1].line_total)).toBe(90.0);

    invoiceId = res.body.invoice.id;
  });

  it("should reject invoice with non-existent customer (400)", async () => {
    const fakeCustomerId = "00000000-0000-0000-0000-000000000000";
    const res = await createInvoice(fakeCustomerId, [
      {
        description: "Test item",
        quantity: 1,
        unit_price: 10.0,
      },
    ]);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/customer/i);
  });

  it("should reject invoice with no line items (400)", async () => {
    const res = await createInvoice(customerId, []);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });

  it("should reject invoice with invalid dates (400)", async () => {
    const res = await request(app)
      .post(`/api/businesses/${businessId}/financials/invoices`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        customer_id: customerId,
        invoice_number: nextInvoiceNumber(),
        issue_date: "not-a-date",
        due_date: "2026-02-01",
        items: [
          {
            description: "Test",
            quantity: 1,
            unit_price: 10.0,
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });

  it("should reject invoice with due_date before issue_date (DB CHECK)", async () => {
    const res = await request(app)
      .post(`/api/businesses/${businessId}/financials/invoices`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        customer_id: customerId,
        invoice_number: nextInvoiceNumber(),
        issue_date: "2026-03-01",
        due_date: "2026-02-01",
        items: [
          {
            description: "Test",
            quantity: 1,
            unit_price: 10.0,
          },
        ],
      });

    // The DB CHECK constraint will reject this
    expect(res.status).toBe(400);
  });

  it("should reject duplicate invoice_number (409)", async () => {
    // Create first invoice
    const res1 = await createInvoice(customerId2, [
      { description: "Item A", quantity: 1, unit_price: 10.0 },
    ]);
    expect(res1.status).toBe(201);

    // Try to create another with the same invoice_number
    const res2 = await request(app)
      .post(`/api/businesses/${businessId}/financials/invoices`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        customer_id: customerId2,
        invoice_number: res1.body.invoice.invoice_number,
        issue_date: "2026-01-01",
        due_date: "2026-02-01",
        items: [
          { description: "Item B", quantity: 1, unit_price: 20.0 },
        ],
      });

    expect(res2.status).toBe(409);
  });

  it("should list invoices with pagination (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/financials/invoices?page=1&limit=10`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.pagination).toHaveProperty("page", 1);
    expect(res.body.pagination).toHaveProperty("limit", 10);
  });

  it("should list invoices filtered by status (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/financials/invoices?status=draft`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((inv) => inv.status === "draft")).toBe(true);
  });

  it("should get a single invoice with items and payment summary (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/financials/invoices/${invoiceId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(invoiceId);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.payments).toBeDefined();
    expect(res.body.payments.count).toBe(0);
    expect(parseFloat(res.body.payments.total_paid)).toBe(0);
    expect(parseFloat(res.body.payments.balance)).toBe(200);
    expect(res.body.payments.is_fully_paid).toBe(false);
  });

  it("should return 404 for non-existent invoice", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .get(`/api/businesses/${businessId}/financials/invoices/${fakeId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it("should transition invoice status: draft → unpaid (200)", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/financials/invoices/${invoiceId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "unpaid" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("unpaid");
  });

  it("should transition invoice status: unpaid → overdue (200)", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/financials/invoices/${invoiceId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "overdue" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("overdue");
  });

  it("should transition invoice status: overdue → unpaid (200)", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/financials/invoices/${invoiceId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "unpaid" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("unpaid");
  });

  it("should reject invalid status transition: unpaid → draft (400)", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/financials/invoices/${invoiceId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "draft" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot transition/i);
  });

  it("should reject status transition to paid (payment-driven only) (400)", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/financials/invoices/${invoiceId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "paid" });

    // paid is not in the allowed enum for manual PATCH
    expect(res.status).toBe(400);
  });

  it("should return 404 when updating status of non-existent invoice", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .patch(`/api/businesses/${businessId}/financials/invoices/${fakeId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "unpaid" });

    expect(res.status).toBe(404);
  });
});

// ===================================================================
// Payment Tests
// ===================================================================

describe("Payments", () => {
  // Create a fresh invoice for payment tests
  let paymentInvoiceId = "";

  it("should create an invoice for payment tests (setup)", async () => {
    const res = await createInvoice(customerId, [
      { description: "Consulting", quantity: 10, unit_price: 20.0, tax_rate: 6 },
    ]);

    expect(res.status).toBe(201);
    paymentInvoiceId = res.body.invoice.id;

    // Verify total: (10*20) + (10*20*6/100) - 0 = 200 + 12 = 212.00
    expect(parseFloat(res.body.invoice.total)).toBe(212.0);
  });

  it("should record a partial payment (201, status → partially_paid)", async () => {
    const res = await request(app)
      .post(`/api/businesses/${businessId}/financials/invoices/${paymentInvoiceId}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: 100.0,
        payment_date: "2026-01-15",
        method: "bank_transfer",
        reference: "BANK-001",
      });

    expect(res.status).toBe(201);
    expect(parseFloat(res.body.amount)).toBe(100);
    expect(res.body.method).toBe("bank_transfer");

    // Verify invoice status was updated to partially_paid
    const invRes = await request(app)
      .get(`/api/businesses/${businessId}/financials/invoices/${paymentInvoiceId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(invRes.body.status).toBe("partially_paid");
    expect(parseFloat(invRes.body.payments.total_paid)).toBe(100);
    expect(parseFloat(invRes.body.payments.balance)).toBe(112);
    expect(invRes.body.payments.is_fully_paid).toBe(false);
  });

  it("should record the final payment (201, status → paid)", async () => {
    const res = await request(app)
      .post(`/api/businesses/${businessId}/financials/invoices/${paymentInvoiceId}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: 112.0,
        payment_date: "2026-01-20",
        method: "cash",
      });

    expect(res.status).toBe(201);
    expect(parseFloat(res.body.amount)).toBe(112);

    // Verify invoice status was updated to paid
    const invRes = await request(app)
      .get(`/api/businesses/${businessId}/financials/invoices/${paymentInvoiceId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(invRes.body.status).toBe("paid");
    expect(parseFloat(invRes.body.payments.total_paid)).toBe(212);
    expect(parseFloat(invRes.body.payments.balance)).toBe(0);
    expect(invRes.body.payments.is_fully_paid).toBe(true);

    paidInvoiceId = paymentInvoiceId;
  });

  it("should reject overpayment (400)", async () => {
    const res = await request(app)
      .post(`/api/businesses/${businessId}/financials/invoices/${paymentInvoiceId}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: 1.0,
        payment_date: "2026-01-25",
        method: "cash",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/overpay/i);
  });

  it("should reject payment with invalid method (400)", async () => {
    // Create a new invoice for this test
    const invRes = await createInvoice(customerId2, [
      { description: "Test", quantity: 1, unit_price: 50.0 },
    ]);
    expect(invRes.status).toBe(201);

    const res = await request(app)
      .post(`/api/businesses/${businessId}/financials/invoices/${invRes.body.invoice.id}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: 10.0,
        payment_date: "2026-01-15",
        method: "bitcoin",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
  });

  it("should handle idempotency: first call 201, second call 200", async () => {
    // Create a new invoice for idempotency test
    const invRes = await createInvoice(customerId, [
      { description: "Idempotency test", quantity: 1, unit_price: 100.0 },
    ]);
    expect(invRes.status).toBe(201);
    const idempInvoiceId = invRes.body.invoice.id;

    const paymentBody = {
      amount: 50.0,
      payment_date: "2026-01-15",
      method: "credit_card",
      idempotency_key: `idem-${ts}-1`,
    };

    // First call — should create the payment (201)
    const res1 = await request(app)
      .post(`/api/businesses/${businessId}/financials/invoices/${idempInvoiceId}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send(paymentBody);

    expect(res1.status).toBe(201);
    expect(parseFloat(res1.body.amount)).toBe(50);
    const firstPaymentId = res1.body.id;

    // Second call with same idempotency key — should return existing payment (200)
    const res2 = await request(app)
      .post(`/api/businesses/${businessId}/financials/invoices/${idempInvoiceId}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send(paymentBody);

    expect(res2.status).toBe(200);
    expect(res2.body.id).toBe(firstPaymentId);
    expect(parseFloat(res2.body.amount)).toBe(50);
  });

  it("should return 404 for payment on non-existent invoice", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .post(`/api/businesses/${businessId}/financials/invoices/${fakeId}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: 10.0,
        payment_date: "2026-01-15",
        method: "cash",
      });

    expect(res.status).toBe(404);
  });

  it("should list payments for an invoice (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/financials/invoices/${paymentInvoiceId}/payments`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBe(2); // two payments: 100 + 112
    expect(res.body.count).toBe(2);
  });

  it("should list payments for an invoice with no payments (200, empty)", async () => {
    // Create a fresh invoice with no payments
    const invRes = await createInvoice(customerId2, [
      { description: "No payment invoice", quantity: 1, unit_price: 5.0 },
    ]);
    expect(invRes.status).toBe(201);

    const res = await request(app)
      .get(`/api/businesses/${businessId}/financials/invoices/${invRes.body.invoice.id}/payments`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.count).toBe(0);
  });
});

// ===================================================================
// Auth & Security Tests
// ===================================================================

describe("Financials auth & security", () => {
  it("should reject all financials routes without a token (401)", async () => {
    const endpoints = [
      { method: "get", path: `/api/businesses/${businessId}/financials/customers` },
      { method: "post", path: `/api/businesses/${businessId}/financials/customers` },
      { method: "get", path: `/api/businesses/${businessId}/financials/invoices` },
    ];

    for (const ep of endpoints) {
      const res = await request(app)[ep.method](ep.path);
      expect(res.status).toBe(401);
    }
  });

  it("should reject access to another business's financials (403)", async () => {
    // Register a second user with a different business
    const email2 = `fin-test2-${ts}@busyness.test`;
    const regRes = await request(app).post("/api/auth/register").send({
      email: email2,
      password: "SecurePass123!",
      name: "User Two",
      business_name: "Business Two",
    });
    testUserEmails.push(email2);
    if (regRes.body.business?.id) testBusinessIds.push(regRes.body.business.id);

    const token2 = regRes.body.token;

    // User 2 tries to access User 1's business financials
    const res = await request(app)
      .get(`/api/businesses/${businessId}/financials/customers`)
      .set("Authorization", `Bearer ${token2}`);

    expect(res.status).toBe(403);
  });

  it("should reject non-UUID business ID in financials (400)", async () => {
    const res = await request(app)
      .get(`/api/businesses/not-a-uuid/financials/customers`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uuid/i);
  });
});

// ===================================================================
// Regression Tests
// ===================================================================

describe("Existing health routes (regression)", () => {
  it("GET /api/health should still return 200", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("Busyness API");
  });

  it("GET /api/health/db should still return 200", async () => {
    const res = await request(app).get("/api/health/db");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.database).toBe("connected");
  });

  it("GET /api/businesses/:businessId/me should still work (200)", async () => {
    const res = await request(app)
      .get(`/api/businesses/${businessId}/me`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.membership.role).toBe("owner");
  });
});
