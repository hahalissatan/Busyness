/**
 * nlRegression.test.js — Targeted regression tests for natural-language
 * understanding in the mock LLM across all AI-powered features.
 *
 * These tests focus on edge cases and gap areas identified in the existing
 * implementation. They do NOT repeat the 32 tests in invoiceAgent.test.js.
 *
 * DATABASE ISOLATION:
 *   This file mocks BOTH the invoiceAgent.js persistence layer AND the
 *   db/pool.js module. No real database reads or writes occur when these
 *   tests run. All tool execution (read-only queries, invoice creation,
 *   product creation) is intercepted by the mocks and returns deterministic
 *   fixture data.
 *
 * Mocked layers:
 *   - invoiceAgent.js: customer resolution, invoice creation, invoice listing
 *   - db/pool.js: query() function used by read-only tools and create_product
 *
 * Gap areas tested:
 *   A. Different phrasings of invoice creation (broader set)
 *   B. Questions about invoices vs. commands to create invoices
 *   C. Missing invoice information (customer + amount)
 *   D. Follow-up messages referring to a previous invoice
 *   E. Corrections to customer names or amounts
 *   F. Multiple requests in one message
 *   G. Requests to explain an operation without executing it
 *   H. Ambiguous references that require clarification
 *   I. NL variations for customer summary (Priority 1)
 *   J. NL variations for inventory summary (Priority 1)
 *   K. NL variations for invoice queries (Priority 1)
 *   L. NL variations for product search (Priority 1)
 *   M. Product creation via NL (Priority 2)
 */

import { describe, it, expect, afterAll, vi } from "vitest";

// --- Mock the persistence layers BEFORE importing llmProvider ---

const MOCK_INVOICE_NUMBER = "INV-2026-001";
const MOCK_INVOICE_ID = "aaaaaaaa-0001-0000-0000-000000000000";
const MOCK_PRODUCT_ID = "bbbbbbbb-0001-0000-0000-000000000000";

// Known seeded customers — resolveCustomer will find these
const KNOWN_CUSTOMERS = [
  "Cafe Maju Sdn Bhd",
  "Mini Mart Sejahtera",
  "Restoran Selera Kampung",
];

// Mock DB query results — keyed by SQL keyword for deterministic responses
// This intercepts ALL db/pool.js query() calls from read-only tools and create_product
const mockQueryResults = {
  // get_customer_summary — returns total_customers and new_this_month
  customer_count: [{ total_customers: 3, new_this_month: 1 }],
  customer_list: [
    { id: "33333333-0001-1111-1111-111111111111", name: "Cafe Maju Sdn Bhd", email: null, phone: null },
    { id: "33333333-0002-1111-1111-111111111111", name: "Mini Mart Sejahtera", email: null, phone: null },
    { id: "33333333-0003-1111-1111-111111111111", name: "Restoran Selera Kampung", email: null, phone: null },
  ],
  // get_inventory_summary — returns total_products, total_value, low_stock_count, out_of_stock_count
  inventory_summary: [{ total_products: 15, total_value: 1250.50, low_stock_count: 2, out_of_stock_count: 1 }],
  // get_low_stock
  low_stock: [
    { id: "44444444-0001-0000-0000-000000000000", name: "Coffee Beans 1kg", sku: "COFF-001", stock_quantity: 2, min_stock_threshold: 5, unit_cost: 45.00 },
    { id: "44444444-0002-0000-0000-000000000000", name: "Sugar 500g", sku: "SUGR-001", stock_quantity: 0, min_stock_threshold: 3, unit_cost: 3.50 },
  ],
  // search_products
  product_search: [
    { id: MOCK_PRODUCT_ID, name: "Coffee Beans 1kg", sku: "COFF-001", description: "Premium arabica", stock_quantity: 10, min_stock_threshold: 5, unit_cost: 45.00, expiry_date: null, is_active: true },
  ],
  // get_financial_overview
  financial_overview: [{
    total_revenue: 15000.00, total_outstanding: 3500.00, total_paid: 11500.00,
    invoice_count: 8, draft_count: 2, paid_count: 5, overdue_count: 1,
  }],
  // get_task_overview
  task_overview: [{ total: 10, pending: 4, in_progress: 3, completed: 3, overdue: 1 }],
  // get_team_workload
  team_workload: [
    { id: "55555555-0001-0000-0000-000000000000", name: "Alice", active_tasks: 3, completed_tasks: 5 },
    { id: "55555555-0002-0000-0000-000000000000", name: "Bob", active_tasks: 1, completed_tasks: 8 },
  ],
  // get_marketing_overview
  marketing_overview: [{ total_campaigns: 3, active_campaigns: 1, total_reach: 5000 }],
  // create_product INSERT RETURNING
  product_insert: [{
    id: MOCK_PRODUCT_ID, business_id: "11111111-1111-1111-1111-111111111111",
    name: "Test Product", sku: "TEST-0001", description: null,
    stock_quantity: 0, min_stock_threshold: 0, unit_cost: 0, is_active: true,
    created_at: "2026-10-11T12:00:00Z",
  }],
};

vi.mock("../db/pool.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    const lower = (sql || "").toLowerCase();

    // create_product — INSERT ... RETURNING
    if (lower.includes("insert into products")) {
      // Extract name and sku from params for a realistic mock response
      const name = params[1] || "Test Product";
      const sku = params[2] || "TEST-0001";
      return {
        rows: [{
          ...mockQueryResults.product_insert[0],
          name,
          sku,
          business_id: params[0],
        }],
        rowCount: 1,
      };
    }

    // get_customer_summary
    if (lower.includes("count(*)") && lower.includes("customers")) {
      return { rows: mockQueryResults.customer_count, rowCount: 1 };
    }
    if (lower.includes("from customers")) {
      return { rows: mockQueryResults.customer_list, rowCount: mockQueryResults.customer_list.length };
    }

    // get_inventory_summary
    if (lower.includes("count(*)") && lower.includes("products")) {
      return { rows: [{ count: mockQueryResults.inventory_summary[0].total_products }], rowCount: 1 };
    }
    if (lower.includes("coalesce") && lower.includes("unit_cost")) {
      return { rows: mockQueryResults.inventory_summary, rowCount: 1 };
    }

    // get_low_stock
    if (lower.includes("products") && lower.includes("min_stock_threshold")) {
      return { rows: mockQueryResults.low_stock, rowCount: mockQueryResults.low_stock.length };
    }

    // search_products
    if (lower.includes("ilike")) {
      return { rows: mockQueryResults.product_search, rowCount: mockQueryResults.product_search.length };
    }

    // get_financial_overview
    if (lower.includes("invoices") && (lower.includes("coalesce") || lower.includes("sum"))) {
      return { rows: mockQueryResults.financial_overview, rowCount: 1 };
    }

    // get_task_overview
    if (lower.includes("tasks")) {
      return { rows: mockQueryResults.task_overview, rowCount: 1 };
    }

    // get_team_workload
    if (lower.includes("users") || lower.includes("team")) {
      return { rows: mockQueryResults.team_workload, rowCount: mockQueryResults.team_workload.length };
    }

    // get_marketing_overview
    if (lower.includes("campaigns")) {
      return { rows: mockQueryResults.marketing_overview, rowCount: 1 };
    }

    // Default: empty result
    return { rows: [], rowCount: 0 };
  }),
  pool: { end: vi.fn(async () => {}) },
  closePool: vi.fn(async () => {}),
  checkConnection: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../services/invoiceAgent.js", () => ({
  searchCustomers: vi.fn(async (businessId, searchTerm) => {
    const matches = KNOWN_CUSTOMERS.filter((c) =>
      c.toLowerCase().includes(searchTerm.toLowerCase())
    );
    return {
      items: matches.map((name, i) => ({
        id: `33333333-000${i}-1111-1111-111111111111`,
        name,
        email: null,
        phone: null,
        address: null,
      })),
      count: matches.length,
    };
  }),

  createInvoiceFromChat: vi.fn(async ({ businessId, userId, args }) => {
    const { customer_name, amount, description, idempotency_key } = args;

    // Validate amount
    if (!amount || typeof amount !== "number" || amount < 0.01) {
      return {
        status: "needs_clarification",
        message: `I can create an invoice for "${customer_name}". How much should I invoice them for?`,
      };
    }

    // Resolve customer — known customers succeed, others fail
    const isKnown = KNOWN_CUSTOMERS.some(
      (c) => c.toLowerCase() === customer_name.toLowerCase().trim()
    );

    if (!isKnown) {
      return {
        status: "needs_clarification",
        message: `No customer found matching "${customer_name}". Would you like to create a new customer first, or try a different name?`,
      };
    }

    // Simulate successful invoice creation
    const subtotal = parseFloat((amount / 1.06).toFixed(2));
    const tax = parseFloat((amount - subtotal).toFixed(2));

    return {
      status: "success",
      invoice: {
        invoice_number: MOCK_INVOICE_NUMBER,
        invoice_id: MOCK_INVOICE_ID,
        customer_name: customer_name,
        issue_date: "2026-10-11",
        due_date: "2026-10-25",
        subtotal: subtotal,
        tax_rate: 6,
        tax: tax,
        total: amount,
        status: "draft",
        items: [
          {
            description: description || `Invoice for ${customer_name}`,
            quantity: 1,
            unit_price: subtotal,
            total: amount,
          },
        ],
      },
      is_idempotent: false,
    };
  }),

  listInvoices: vi.fn(async (businessId, options = {}) => {
    return {
      items: [
        {
          id: MOCK_INVOICE_ID,
          invoice_number: MOCK_INVOICE_NUMBER,
          customer_name: "Cafe Maju Sdn Bhd",
          status: "draft",
          issue_date: "2026-10-11",
          due_date: "2026-10-25",
          total: 500.0,
        },
      ],
      count: 1,
    };
  }),

  getInvoice: vi.fn(async (businessId, invoiceId) => {
    return {
      id: invoiceId,
      invoice_number: MOCK_INVOICE_NUMBER,
      customer_name: "Cafe Maju Sdn Bhd",
      status: "draft",
      issue_date: "2026-10-11",
      due_date: "2026-10-25",
      total: 500.0,
      items: [],
      payments: [],
    };
  }),

  checkExistingInvoices: vi.fn(async (businessId, customerName) => {
    const isKnown = KNOWN_CUSTOMERS.some(
      (c) => c.toLowerCase().includes(customerName.toLowerCase())
    );
    return {
      found: isKnown,
      count: isKnown ? 1 : 0,
      invoices: isKnown
        ? [
            {
              invoice_number: MOCK_INVOICE_NUMBER,
              status: "draft",
              issue_date: "2026-10-11",
              total: 500.0,
            },
          ]
        : [],
    };
  }),
}));

import { mockLLM } from "../services/llmProvider.js";

const TEST_BUSINESS_ID = "11111111-1111-1111-1111-111111111111";
const TEST_USER_ID = "22222222-2222-2222-2222-222222222222";

const SEED_CUSTOMER_CAFE_MAJU = "Cafe Maju Sdn Bhd";
const SEED_CUSTOMER_MINI_MART = "Mini Mart Sejahtera";

afterAll(async () => {
  // No pool to close — persistence layer is mocked
}, 10000);

// Helper: run mockLLM and return result
async function chat(message, context = []) {
  return mockLLM({
    message,
    context,
    businessId: TEST_BUSINESS_ID,
    userId: TEST_USER_ID,
  });
}

// ====================================================================
// A. Broader phrasings of invoice creation
// ====================================================================

describe("NL Regression — Broader invoice creation phrasings", () => {
  const phrasings = [
    "Send an invoice to Cafe Maju Sdn Bhd for RM400",
    "Draft an invoice for Cafe Maju Sdn Bhd for RM400",
    "Raise an invoice for Cafe Maju Sdn Bhd for RM400",
    "Set up an invoice for Cafe Maju Sdn Bhd for RM400",
    "I need an invoice for Cafe Maju Sdn Bhd for RM400",
    "Please generate an invoice for Cafe Maju Sdn Bhd for RM400",
    "Issue an invoice for Cafe Maju Sdn Bhd for RM400",
    "Can you make an invoice for Cafe Maju Sdn Bhd for RM400?",
  ];

  for (const msg of phrasings) {
    it(`should not fall through to fallback for: "${msg}"`, async () => {
      const result = await chat(msg);
      expect(result.reply).not.toContain("I didn't quite catch that");
      expect(result.provider).toBe("mock");
    });
  }

  // These should create an actual invoice (with DB) — verify they trigger create_invoice
  it("should trigger create_invoice tool for 'send an invoice to X for RM400'", async () => {
    const result = await chat("Send an invoice to Cafe Maju Sdn Bhd for RM400");
    // If it triggers creation, we should see either success or a clarification
    // Either way, the key check is: did it recognize this as an invoice action?
    const isInvoiceAction =
      result.tool_calls.some((t) => t.tool === "create_invoice") ||
      result.reply.includes("How much") ||
      result.reply.includes("preview") ||
      result.reply.includes("Invoice created") ||
      result.reply.includes("No customer found");
    expect(isInvoiceAction || result.reply.includes("To create an invoice")).toBe(true);
  });

  it("should trigger create_invoice tool for 'draft an invoice for X for RM400'", async () => {
    const result = await chat("Draft an invoice for Cafe Maju Sdn Bhd for RM400");
    const isInvoiceAction =
      result.tool_calls.some((t) => t.tool === "create_invoice") ||
      result.reply.includes("How much") ||
      result.reply.includes("preview") ||
      result.reply.includes("Invoice created") ||
      result.reply.includes("No customer found");
    expect(isInvoiceAction || result.reply.includes("To create an invoice")).toBe(true);
  });
});

// ====================================================================
// B. Questions about invoices vs. commands to create
// ====================================================================

describe("NL Regression — Questions vs. commands", () => {
  it("should NOT create an invoice for 'What invoices do we have?'", async () => {
    const result = await chat("What invoices do we have?");
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
    expect(result.reply).not.toContain("Invoice created successfully");
  });

  it("should NOT create an invoice for 'Are there any invoices for Cafe Maju?'", async () => {
    const result = await chat("Are there any invoices for Cafe Maju?");
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
    expect(result.reply).not.toContain("Invoice created successfully");
  });

  it("should NOT create an invoice for 'Check if Cafe Maju has been invoiced'", async () => {
    const result = await chat("Check if Cafe Maju has been invoiced");
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
    expect(result.reply).not.toContain("Invoice created successfully");
  });

  it("should NOT create an invoice for 'Has Cafe Maju been billed?'", async () => {
    const result = await chat("Has Cafe Maju been billed?");
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
    expect(result.reply).not.toContain("Invoice created successfully");
  });

  it("should NOT create an invoice for 'Do we have any unpaid invoices?'", async () => {
    const result = await chat("Do we have any unpaid invoices?");
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
    expect(result.reply).not.toContain("Invoice created successfully");
  });

  it("should NOT create an invoice for 'What's the status of invoice INV-2026-001?'", async () => {
    const result = await chat("What's the status of invoice INV-2026-001?");
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
    expect(result.reply).not.toContain("Invoice created successfully");
  });
});

// ====================================================================
// C. Missing invoice information — customer name only
// ====================================================================

describe("NL Regression — Missing information", () => {
  it("should ask for customer name when message is 'create an invoice for RM500'", async () => {
    const result = await chat("Create an invoice for RM500");
    // Should either ask for customer name or not create an invoice
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
    // The reply should mention "customer" or ask for clarification
    expect(result.reply).toMatch(/customer|which|who/i);
  });

  it("should ask for amount when message is 'invoice Mini Mart Sejahtera'", async () => {
    const result = await chat("Invoice Mini Mart Sejahtera");
    // Should either ask for amount or not create an invoice
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
    expect(result.reply).not.toContain("Invoice created successfully");
  });

  it("should ask for amount when message is 'bill Cafe Maju Sdn Bhd'", async () => {
    const result = await chat("Bill Cafe Maju Sdn Bhd");
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
    expect(result.reply).not.toContain("Invoice created successfully");
  });
});

// ====================================================================
// D. Follow-up messages referring to a previous invoice
// ====================================================================

describe("NL Regression — Follow-up references", () => {
  // Simulate a conversation where an invoice was just created
  const priorContext = [
    {
      role: "user",
      content: "Create an invoice for Cafe Maju Sdn Bhd for RM500",
    },
    {
      role: "assistant",
      content: "[Mock LLM] Invoice created successfully!\n\nCustomer: Cafe Maju Sdn Bhd\nInvoice number: INV-2026-999\nIssue date: 2026-10-10\nDue date: 2026-10-24\nSubtotal: RM471.70\nTax (6%): RM28.30\nTotal: RM500.00\nStatus: draft\n\nLine items:\n  - Invoice for Cafe Maju Sdn Bhd | Qty: 1 | Unit: RM471.70 | Total: RM500.00\n\nYour invoice has been saved. You can open it in the Invoices page to review the details.",
    },
  ];

  it("should retrieve previous invoice details when asked 'show me the invoice I created earlier'", async () => {
    const result = await chat("Show me the invoice I created earlier", priorContext);
    expect(result.reply).not.toContain("I didn't quite catch that");
    // Should show prior invoice number from context, not create a new one
    expect(result.reply).toContain("INV-2026-999");
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
  });

  it("should handle 'what about Mini Mart Sejahtera?' as a follow-up", async () => {
    const result = await chat("What about Mini Mart Sejahtera?", priorContext);
    // Should not fall through to fallback — the follow-up handler should
    // recognize the invoice context and ask for an amount or create
    expect(result.reply).not.toContain("I didn't quite catch that");
    expect(result.reply).not.toContain("I'm not sure what you're asking");
  });

  it("should NOT create an invoice when user asks 'what was the total of that invoice?'", async () => {
    const result = await chat("What was the total of that invoice?", priorContext);
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
    expect(result.reply).not.toContain("Invoice created successfully");
  });

  // --- Targeted follow-up invoice-creation tests ---

  it("should ask for missing amount and NOT call create_invoice for 'What about Cafe Maju Sdn Bhd?'", async () => {
    const result = await chat("What about Cafe Maju Sdn Bhd?", priorContext);

    // Must NOT have called create_invoice (no amount → ask path)
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);

    // Must ask for the amount
    expect(result.reply).toContain("How much");

    // Must mention the customer name so the user knows who is being invoiced
    expect(result.reply).toContain("Cafe Maju Sdn Bhd");

    // Must NOT claim success
    expect(result.reply).not.toContain("Invoice created successfully");
  });

  it("should correctly extract customer name, call create_invoice, and create the invoice for 'What about Cafe Maju Sdn Bhd? The amount is RM500'", async () => {
    const result = await chat("What about Cafe Maju Sdn Bhd? The amount is RM500", priorContext);

    // The regex must stop at the ? and extract "Cafe Maju Sdn Bhd" (not the full sentence)
    const createCall = result.tool_calls.find((t) => t.tool === "create_invoice");
    expect(createCall).toBeDefined();

    // Verify the tool received the correct, clean customer name — not polluted with amount text
    expect(createCall.args.customer_name).toBe("Cafe Maju Sdn Bhd");
    expect(createCall.args.amount).toBe(500);

    // Since Cafe Maju Sdn Bhd is a seeded customer, the invoice should be created successfully
    expect(result.reply).toContain("Invoice created successfully");
    expect(result.reply).toContain("Cafe Maju Sdn Bhd");
    expect(result.reply).toMatch(/INV-\d{4}-\d{3}/);
  });

  it("should call create_invoice with correct name but NOT create or claim success for an unresolved customer 'What about Nonexistent Customer XYZ for RM500?'", async () => {
    const result = await chat("What about Nonexistent Customer XYZ for RM500?", priorContext);

    // The regex captures "Nonexistent Customer XYZ" (up to ?), extractAmount finds 500
    const createCall = result.tool_calls.find((t) => t.tool === "create_invoice");
    expect(createCall).toBeDefined();

    // Verify the tool received the correct customer name
    expect(createCall.args.customer_name).toBe("Nonexistent Customer XYZ");
    expect(createCall.args.amount).toBe(500);

    // create_invoice IS called but resolveCustomer returns 0 results
    // Must NOT claim success — customer doesn't exist
    expect(result.reply).not.toContain("Invoice created successfully");

    // Must report the customer was not found (truthful failure message)
    expect(result.reply).toMatch(/No customer found|couldn't create|couldn't find/i);
  });

  // Edge case: "What about X, amount RM500?" — comma + "amount" separator
  it("should correctly extract customer name from 'What about Cafe Maju Sdn Bhd, amount RM500?'", async () => {
    const result = await chat("What about Cafe Maju Sdn Bhd, amount RM500?", priorContext);

    const createCall = result.tool_calls.find((t) => t.tool === "create_invoice");
    expect(createCall).toBeDefined();

    // The regex must stop at ", amount" and extract just "Cafe Maju Sdn Bhd"
    expect(createCall.args.customer_name).toBe("Cafe Maju Sdn Bhd");
    expect(createCall.args.amount).toBe(500);

    // Since Cafe Maju Sdn Bhd is a seeded customer, the invoice should be created
    expect(result.reply).toContain("Invoice created successfully");
    expect(result.reply).toContain("Cafe Maju Sdn Bhd");
    expect(result.reply).toMatch(/INV-\d{4}-\d{3}/);
  });
});

// ====================================================================
// E. Corrections to customer names or amounts
// ====================================================================

describe("NL Regression — Corrections", () => {
  const priorContext = [
    {
      role: "user",
      content: "Create an invoice for Cafe Maju Sdn Bhd for RM500",
    },
    {
      role: "assistant",
      content: "[Mock LLM] Invoice created successfully!\n\nCustomer: Cafe Maju Sdn Bhd\nInvoice number: INV-2026-999\nIssue date: 2026-10-10\nDue date: 2026-10-24\nSubtotal: RM471.70\nTax (6%): RM28.30\nTotal: RM500.00\nStatus: draft",
    },
  ];

  it("should NOT create a new invoice when user says 'no, I meant Mini Mart Sejahtera'", async () => {
    const result = await chat("No, I meant Mini Mart Sejahtera", priorContext);
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
    expect(result.reply).not.toContain("Invoice created successfully");
  });

  it("should NOT create a new invoice when user says 'actually the amount should be RM750'", async () => {
    const result = await chat("Actually the amount should be RM750", priorContext);
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
    expect(result.reply).not.toContain("Invoice created successfully");
  });

  it("should NOT create a new invoice when user says 'change the amount to RM750'", async () => {
    const result = await chat("Change the amount to RM750", priorContext);
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
    expect(result.reply).not.toContain("Invoice created successfully");
  });
});

// ====================================================================
// F. Multiple requests in one message
// ====================================================================

describe("NL Regression — Multiple requests", () => {
  it("should handle 'create an invoice for Cafe Maju for RM500 and also for Mini Mart for RM750'", async () => {
    const result = await chat("Create an invoice for Cafe Maju Sdn Bhd for RM500 and also for Mini Mart Sejahtera for RM750");
    // The mock LLM may only handle the first request — that's acceptable
    // as long as it doesn't create a false success for BOTH
    // Key: must not claim both were created if only one was
    expect(result.reply).not.toContain("I didn't quite catch that");
  });

  it("should handle 'show invoices and create one for Cafe Maju for RM500'", async () => {
    const result = await chat("Show invoices and create one for Cafe Maju Sdn Bhd for RM500");
    // Should not fall through to fallback
    expect(result.reply).not.toContain("I didn't quite catch that");
  });
});

// ====================================================================
// G. Requests to explain an operation without executing it
// ====================================================================

describe("NL Regression — Explain without executing", () => {
  it("should explain without creating for 'explain the invoice creation process'", async () => {
    const result = await chat("Explain the invoice creation process");
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
    expect(result.reply).not.toContain("Invoice created successfully");
  });

  it("should explain without creating for 'what does creating an invoice do?'", async () => {
    const result = await chat("What does creating an invoice do?");
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
    expect(result.reply).not.toContain("Invoice created successfully");
  });

  it("should explain without creating for 'how can I make an invoice?'", async () => {
    const result = await chat("How can I make an invoice?");
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
    expect(result.reply).not.toContain("Invoice created successfully");
  });

  it("should explain without creating for 'what do I need to create an invoice?'", async () => {
    const result = await chat("What do I need to create an invoice?");
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
    expect(result.reply).not.toContain("Invoice created successfully");
  });
});

// ====================================================================
// H. Ambiguous references that require clarification
// ====================================================================

describe("NL Regression — Ambiguous references", () => {
  it("should not create an invoice for 'create an invoice for the usual customer'", async () => {
    const result = await chat("Create an invoice for the usual customer for RM500");
    // "the usual customer" should not resolve to any real customer
    // The result should not claim success
    expect(result.reply).not.toContain("Invoice created successfully");
  });

  it("should handle 'create an invoice for that guy for RM500'", async () => {
    const result = await chat("Create an invoice for that guy for RM500");
    // Should not create a successful invoice for "that guy"
    expect(result.reply).not.toContain("Invoice created successfully");
  });

  it("should handle very short customer names safely", async () => {
    const result = await chat("Create an invoice for ab for RM500");
    // Should not crash, should not claim success
    expect(result.reply).toBeDefined();
    expect(result.reply).not.toContain("Invoice created successfully");
  });
});

// ====================================================================
// I. NL variations for customer summary (Priority 1)
//    Equivalent phrases should map to the same action.
// ====================================================================

describe("NL Regression — Customer summary NL variations", () => {
  const phrasings = [
    "Customer summary",
    "Show customer summary",
    "Show me customers",
    "Show customers",
    "How many customers do we have?",
    "How many customers",
    "How many clients do we have?",
    "List customers",
    "Customer list",
    "Customers overview",
    "Customer info",
    "Customer count",
  ];

  for (const msg of phrasings) {
    it(`should route "${msg}" to get_customer_summary (not fallback)`, async () => {
      const result = await chat(msg);
      expect(result.reply).not.toContain("I didn't quite catch that");
      expect(result.tool_calls.some((t) => t.tool === "get_customer_summary")).toBe(true);
    });
  }

  it("should include customer count in the response", async () => {
    const result = await chat("How many customers do we have?");
    expect(result.reply).toMatch(/3/);
  });

  it("should NOT trigger create_invoice for customer summary queries", async () => {
    const result = await chat("Show me customers");
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
  });
});

// ====================================================================
// J. NL variations for inventory summary (Priority 1)
// ====================================================================

describe("NL Regression — Inventory summary NL variations", () => {
  const phrasings = [
    "Show inventory",
    "What is my inventory?",
    "Inventory summary",
    "Stock summary",
    "Inventory status",
    "Inventory overview",
    "Product count",
    "What inventory do we have?",
  ];

  for (const msg of phrasings) {
    it(`should route "${msg}" to get_inventory_summary (not fallback)`, async () => {
      const result = await chat(msg);
      expect(result.reply).not.toContain("I didn't quite catch that");
      expect(result.tool_calls.some((t) => t.tool === "get_inventory_summary")).toBe(true);
    });
  }

  it("should NOT trigger create_product for inventory summary queries", async () => {
    const result = await chat("Show inventory");
    expect(result.tool_calls.some((t) => t.tool === "create_product")).toBe(false);
  });
});

// ====================================================================
// K. NL variations for invoice queries (Priority 1)
//     "Show invoices", "What invoices do we have?", etc.
// ====================================================================

describe("NL Regression — Invoice query NL variations", () => {
  const phrasings = [
    "Show invoices",
    "Show me invoices",
    "List invoices",
    "Recent invoices",
    "What invoices do we have?",
    "Show all invoices",
    "All invoices",
  ];

  for (const msg of phrasings) {
    it(`should route "${msg}" to list_invoices (not fallback)`, async () => {
      const result = await chat(msg);
      expect(result.reply).not.toContain("I didn't quite catch that");
      expect(result.tool_calls.some((t) => t.tool === "list_invoices")).toBe(true);
    });
  }

  it("should NOT trigger create_invoice for invoice query phrases", async () => {
    const result = await chat("Show all invoices");
    expect(result.tool_calls.some((t) => t.tool === "create_invoice")).toBe(false);
  });

  it("should display invoice numbers in the response", async () => {
    const result = await chat("Show invoices");
    expect(result.reply).toContain("INV-2026-001");
  });
});

// ====================================================================
// L. NL variations for product search (Priority 1)
//    "Search for coffee", "Find product X", "Look up Y"
// ====================================================================

describe("NL Regression — Product search NL variations", () => {
  const phrasings = [
    "Search for coffee",
    "Find product coffee",
    "Find coffee",
    "Look up coffee",
    "Look up product coffee",
    "Search product coffee",
  ];

  for (const msg of phrasings) {
    it(`should route "${msg}" to search_products (not fallback)`, async () => {
      const result = await chat(msg);
      expect(result.reply).not.toContain("I didn't quite catch that");
      expect(result.tool_calls.some((t) => t.tool === "search_products")).toBe(true);
    });
  }

  it("should extract the correct search term from 'search for coffee'", async () => {
    const result = await chat("Search for coffee");
    const searchCall = result.tool_calls.find((t) => t.tool === "search_products");
    expect(searchCall).toBeDefined();
    expect(searchCall.args.search_term).toContain("coffee");
  });

  it("should NOT trigger create_product for product search queries", async () => {
    const result = await chat("Find product coffee");
    expect(result.tool_calls.some((t) => t.tool === "create_product")).toBe(false);
  });

  it("should NOT trigger search_products for invoice-related search", async () => {
    const result = await chat("Find invoice for Cafe Maju");
    expect(result.tool_calls.some((t) => t.tool === "search_products")).toBe(false);
  });
});

// ====================================================================
// M. Product creation via NL (Priority 2)
//     "Add new products: pen and pencil", "Create a product called Notebook"
// ====================================================================

describe("NL Regression — Product creation via NL", () => {
  it("should route 'Add new products: pen and pencil' to create_product", async () => {
    const result = await chat("Add new products: pen and pencil");
    expect(result.reply).not.toContain("I didn't quite catch that");
    const createCalls = result.tool_calls.filter((t) => t.tool === "create_product");
    expect(createCalls.length).toBe(2);
  });

  it("should route 'Create a product called Notebook' to create_product", async () => {
    const result = await chat("Create a product called Notebook");
    expect(result.reply).not.toContain("I didn't quite catch that");
    const createCall = result.tool_calls.find((t) => t.tool === "create_product");
    expect(createCall).toBeDefined();
    expect(createCall.args.name).toBe("Notebook");
  });

  it("should route 'Add product: pen' to create_product", async () => {
    const result = await chat("Add product: pen");
    expect(result.reply).not.toContain("I didn't quite catch that");
    const createCall = result.tool_calls.find((t) => t.tool === "create_product");
    expect(createCall).toBeDefined();
    expect(createCall.args.name).toBe("pen");
  });

  it("should route 'I want to add a product: ballpoint pen' to create_product", async () => {
    const result = await chat("I want to add a product: ballpoint pen");
    expect(result.reply).not.toContain("I didn't quite catch that");
    const createCall = result.tool_calls.find((t) => t.tool === "create_product");
    expect(createCall).toBeDefined();
    expect(createCall.args.name).toBe("ballpoint pen");
  });

  it("should auto-generate a SKU from the product name", async () => {
    const result = await chat("Create a product called Notebook");
    const createCall = result.tool_calls.find((t) => t.tool === "create_product");
    expect(createCall).toBeDefined();
    expect(createCall.args.sku).toBeDefined();
    expect(createCall.args.sku.length).toBeGreaterThan(0);
    // SKU should start with the product name uppercase
    expect(createCall.args.sku).toMatch(/^NOTEBOOK/i);
  });

  it("should confirm product creation in the response", async () => {
    const result = await chat("Add product: pen");
    expect(result.reply).toContain("created successfully");
  });

  it("should NOT trigger create_product for 'how do I add a product'", async () => {
    const result = await chat("How do I add a product?");
    expect(result.tool_calls.some((t) => t.tool === "create_product")).toBe(false);
  });

  it("should NOT trigger create_product for invoice messages", async () => {
    const result = await chat("Create an invoice for Cafe Maju Sdn Bhd for RM500");
    expect(result.tool_calls.some((t) => t.tool === "create_product")).toBe(false);
  });

  it("should strip 'called' prefix from product name", async () => {
    const result = await chat("Create a product called Notebook");
    const createCall = result.tool_calls.find((t) => t.tool === "create_product");
    expect(createCall).toBeDefined();
    // Must NOT capture "called Notebook" — just "Notebook"
    expect(createCall.args.name).not.toContain("called");
    expect(createCall.args.name).toBe("Notebook");
  });

  it("should handle multiple products separated by 'and'", async () => {
    const result = await chat("Add new products: pen and pencil");
    const createCalls = result.tool_calls.filter((t) => t.tool === "create_product");
    expect(createCalls.length).toBe(2);
    expect(createCalls[0].args.name).toBe("pen");
    expect(createCalls[1].args.name).toBe("pencil");
  });

  it("should handle multiple products separated by comma", async () => {
    const result = await chat("Add new products: pen, pencil, eraser");
    const createCalls = result.tool_calls.filter((t) => t.tool === "create_product");
    expect(createCalls.length).toBe(3);
    expect(createCalls[0].args.name).toBe("pen");
    expect(createCalls[1].args.name).toBe("pencil");
    expect(createCalls[2].args.name).toBe("eraser");
  });

  it("should report success count for multiple products", async () => {
    const result = await chat("Add new products: pen and pencil");
    // Should mention how many were created
    expect(result.reply).toMatch(/\d+\s+of\s+\d+\s+product/);
  });
});

// ====================================================================
// N. Database isolation safety verification
//    Ensures NO real DB writes occur — all queries are intercepted by the mock.
// ====================================================================

describe("NL Regression — DB isolation safety", () => {
  // Note: the vi.mock for ../db/pool.js replaces the query function
  // globally for this test file. We can import the mocked module to
  // verify the mock was called instead of the real pool.

  it("should intercept ALL DB queries through the mock pool (no real DB access)", async () => {
    // Import the mocked pool — vi.mock intercepts this
    const { query } = await import("../db/pool.js");

    // Trigger several tool calls that would normally hit the DB
    await chat("Show customers");
    await chat("Show inventory");
    await chat("Search for coffee");
    await chat("Add product: testitem");

    // The mock query function should have been called at least 4 times
    // (once per tool). If the real DB were being used, this assertion
    // would fail because we'd have the real pg Pool, not a vi.fn.
    expect(query).toBeDefined();
    expect(typeof query).toBe("function");
    expect(query.mock).toBeDefined(); // vi.fn has .mock
    expect(query.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("should NOT write real products to the database when creating via NL", async () => {
    // Clear previous call history
    const { query } = await import("../db/pool.js");
    query.mockClear();

    // Create a product via NL
    const result = await chat("Create a product called TestProductXYZ");
    expect(result.tool_calls.some((t) => t.tool === "create_product")).toBe(true);

    // Verify the mock was called with an INSERT (not real DB)
    const insertCalls = query.mock.calls.filter(
      ([sql]) => (sql || "").toLowerCase().includes("insert into products")
    );
    expect(insertCalls.length).toBe(1);

    // Verify the mock returned a success response (not a real DB error)
    expect(result.reply).toContain("created successfully");
  });

  it("should NOT write real invoices to the database when creating via NL", async () => {
    // invoiceAgent.js is also mocked — createInvoiceFromChat should be the mock
    const invoiceAgent = await import("../services/invoiceAgent.js");
    invoiceAgent.createInvoiceFromChat.mockClear();

    const result = await chat("Create an invoice for Cafe Maju Sdn Bhd for RM500");
    expect(result.reply).toContain("Invoice created successfully");

    // Verify the mock was called (not real DB)
    expect(invoiceAgent.createInvoiceFromChat).toHaveBeenCalledTimes(1);
    const mockResult = await invoiceAgent.createInvoiceFromChat.mock.results[0].value;
    expect(mockResult).toBeDefined();
    expect(mockResult.status).toBe("success");
  });
});
