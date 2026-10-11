/**
 * services/inMemoryStore.js — In-memory data store for development without PostgreSQL.
 *
 * When PostgreSQL is not available, this module provides realistic seed data
 * so the application is fully functional for demos and development.
 *
 * The store mimics the database schema and provides query-like access
 * for the tool functions used by the conversational AI.
 */

// --- Seed data ------------------------------------------------------------

const BUSINESS_ID = "d1a20001-0000-4000-8000-000000000001";
const USER_ID = "d1a20002-0000-4000-8000-000000000002";

const products = [
  { id: "p001", name: "Arabica Coffee Beans 1kg", sku: "CFE-ARA-1KG", stock_quantity: 45, min_stock_threshold: 20, unit_cost: 28.50, is_active: true, description: "Premium Arabica beans from Colombia", expiry_date: "2026-12-15" },
  { id: "p002", name: "Robusta Coffee Beans 1kg", sku: "CFE-ROB-1KG", stock_quantity: 12, min_stock_threshold: 15, unit_cost: 22.00, is_active: true, description: "Strong Robusta beans from Vietnam", expiry_date: "2026-10-20" },
  { id: "p003", name: "Organic Green Tea 200g", sku: "TEA-GRN-200", stock_quantity: 8, min_stock_threshold: 10, unit_cost: 15.00, is_active: true, description: "Organic green tea leaves", expiry_date: "2026-11-30" },
  { id: "p004", name: "Matcha Powder 100g", sku: "TEA-MAT-100", stock_quantity: 0, min_stock_threshold: 5, unit_cost: 45.00, is_active: true, description: "Ceremonial grade matcha", expiry_date: "2027-01-10" },
  { id: "p005", name: "Stainless Steel Thermos 500ml", sku: "ACC-THR-500", stock_quantity: 67, min_stock_threshold: 20, unit_cost: 32.00, is_active: true, description: "Double-walled vacuum thermos", expiry_date: null },
  { id: "p006", name: "Bamboo Coffee Filter", sku: "ACC-FLR-BAM", stock_quantity: 3, min_stock_threshold: 10, unit_cost: 8.50, is_active: true, description: "Reusable bamboo coffee filter", expiry_date: null },
  { id: "p007", name: "Glass Storage Jar 1L", sku: "ACC-JAR-1L", stock_quantity: 34, min_stock_threshold: 12, unit_cost: 12.00, is_active: true, description: "Airtight glass storage jar", expiry_date: null },
  { id: "p008", name: "Cold Brew Concentrate 500ml", sku: "BEV-CB-500", stock_quantity: 5, min_stock_threshold: 8, unit_cost: 18.00, is_active: true, description: "Ready-to-drink cold brew", expiry_date: "2026-10-18" },
  { id: "p009", name: "Espresso Tamper 58mm", sku: "ACC-TMP-58", stock_quantity: 22, min_stock_threshold: 8, unit_cost: 25.00, is_active: true, description: "Stainless steel espresso tamper", expiry_date: null },
  { id: "p010", name: "Oat Milk 1L", sku: "BEV-OAT-1L", stock_quantity: 2, min_stock_threshold: 10, unit_cost: 6.50, is_active: true, description: "Barista-grade oat milk", expiry_date: "2026-10-14" },
];

const suppliers = [
  { id: "s001", name: "Highland Coffee Roasters", contact_person: "Sarah Chen", phone: "+6012-345-6789", email: "sarah@highlandroast.com" },
  { id: "s002", name: "Tea Valley Imports", contact_person: "Mike Tan", phone: "+6012-987-6543", email: "mike@teavalley.com" },
  { id: "s003", name: "EcoPack Solutions", contact_person: "Lisa Wong", phone: "+6016-555-0199", email: "lisa@ecopack.my" },
];

const customers = [
  { id: "c001", name: "Urban Blend Cafe", email: "orders@urbanblend.com", phone: "+603-2200-1100", created_at: "2026-09-15" },
  { id: "c002", name: "Morning Brew Restaurant", email: "contact@morningbrew.com", phone: "+603-2300-2200", created_at: "2026-10-01" },
  { id: "c003", name: "The Daily Grind Co.", email: "hello@dailygrind.com", phone: "+603-2400-3300", created_at: "2026-10-08" },
];

const invoices = [
  { id: "i001", customer_name: "Urban Blend Cafe", status: "paid", total: 1250.00 },
  { id: "i002", customer_name: "Morning Brew Restaurant", status: "unpaid", total: 890.50 },
  { id: "i003", customer_name: "The Daily Grind Co.", status: "overdue", total: 320.00 },
  { id: "i004", customer_name: "Urban Blend Cafe", status: "draft", total: 540.00 },
  { id: "i005", customer_name: "Morning Brew Restaurant", status: "partially_paid", total: 1100.00 },
];

const tasks = [
  { id: "t001", title: "Restock low inventory items", status: "in_progress", deadline: "2026-10-12", assignee: "Sarah Chen" },
  { id: "t002", title: "Q4 marketing campaign planning", status: "pending", deadline: "2026-10-15", assignee: "Mike Tan" },
  { id: "t003", title: "Supplier negotiation - Highland Roasters", status: "pending", deadline: "2026-10-14", assignee: "Lisa Wong" },
  { id: "t004", title: "Monthly financial reconciliation", status: "completed", deadline: "2026-10-05", assignee: "Sarah Chen" },
  { id: "t005", title: "Update product catalog prices", status: "overdue", deadline: "2026-10-08", assignee: "Mike Tan" },
  { id: "t006", title: "Customer feedback follow-up calls", status: "in_progress", deadline: "2026-10-13", assignee: "Lisa Wong" },
];

const teamMembers = [
  { id: "e001", name: "Sarah Chen", role: "Operations Manager", assigned: 3, active: 1, overdue: 0 },
  { id: "e002", name: "Mike Tan", role: "Sales Lead", assigned: 3, active: 1, overdue: 1 },
  { id: "e003", name: "Lisa Wong", role: "Marketing Specialist", assigned: 3, active: 1, overdue: 0 },
];

const marketingProjects = [
  { id: "m001", name: "Holiday Season Campaign", status: "active" },
  { id: "m002", name: "New Product Launch - Matcha Line", status: "draft" },
  { id: "m003", name: "Customer Loyalty Program", status: "completed" },
];

// --- Tool data accessors --------------------------------------------------

export function getLowStock() {
  const items = products.filter(p => p.stock_quantity <= p.min_stock_threshold);
  return { items, count: items.length };
}

export function getInventorySummary() {
  return {
    total_products: products.length,
    total_value: products.reduce((sum, p) => sum + p.stock_quantity * p.unit_cost, 0),
    low_stock_count: products.filter(p => p.stock_quantity <= p.min_stock_threshold).length,
    out_of_stock_count: products.filter(p => p.stock_quantity === 0).length,
  };
}

export function getTaskOverview() {
  return {
    total_tasks: tasks.length,
    pending: tasks.filter(t => t.status === "pending").length,
    in_progress: tasks.filter(t => t.status === "in_progress").length,
    completed: tasks.filter(t => t.status === "completed").length,
    overdue: tasks.filter(t => t.status === "overdue" || (t.deadline < new Date().toISOString().split("T")[0] && t.status !== "completed")).length,
  };
}

export function getTeamWorkload() {
  return { team: teamMembers, count: teamMembers.length };
}

export function getFinancialOverview() {
  return {
    total_invoices: invoices.length,
    draft: invoices.filter(i => i.status === "draft").length,
    unpaid: invoices.filter(i => i.status === "unpaid").length,
    partially_paid: invoices.filter(i => i.status === "partially_paid").length,
    paid: invoices.filter(i => i.status === "paid").length,
    overdue: invoices.filter(i => i.status === "overdue").length,
    total_revenue: invoices.reduce((s, i) => s + i.total, 0),
    collected: invoices.filter(i => i.status === "paid").reduce((s, i) => s + i.total, 0),
    outstanding: invoices.filter(i => ["unpaid", "partially_paid", "overdue"].includes(i.status)).reduce((s, i) => s + i.total, 0),
  };
}

export function getCustomerSummary() {
  return {
    total_customers: customers.length,
    new_this_month: 2,
  };
}

export function getMarketingOverview() {
  return {
    total_projects: marketingProjects.length,
    draft: marketingProjects.filter(p => p.status === "draft").length,
    active: marketingProjects.filter(p => p.status === "active").length,
    completed: marketingProjects.filter(p => p.status === "completed").length,
    total_drafts: 4,
    total_pitch_decks: 2,
  };
}

export function searchProducts(searchTerm) {
  if (!searchTerm || searchTerm.length < 2) return { items: [], count: 0, search_term: searchTerm };
  const lower = searchTerm.toLowerCase();
  const items = products.filter(p =>
    p.name.toLowerCase().includes(lower) ||
    p.sku.toLowerCase().includes(lower) ||
    (p.description && p.description.toLowerCase().includes(lower))
  );
  return { items, count: items.length, search_term: searchTerm };
}

export { BUSINESS_ID, USER_ID, products, suppliers, customers, invoices, tasks, teamMembers, marketingProjects };
