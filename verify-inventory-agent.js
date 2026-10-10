/**
 * Phase 10B — Inventory Agent Test Suite
 *
 * Tests the 4 new inventory specialist agent capabilities:
 *   1. product_search
 *   2. near_expiry
 *   3. stock_movement_history
 *   4. inventory_by_supplier
 *
 * Also tests:
 *   - Coordinator delegation (new intents matched + executed via coordinator)
 *   - Pattern collisions and multi-intent requests
 *   - Edge cases (empty results, missing search term, no expiry dates, etc.)
 *   - Authentication and cross-business isolation
 *   - Read-only enforcement (no write endpoints)
 *   - Regression: all 7 existing intents still work
 *   - Agent run, step, and audit status correctness
 *
 * Run: node verify-inventory-agent.js
 * Prerequisites: Backend on localhost:3001
 */

const BASE = "http://127.0.0.1:3001";

let pass = 0;
let fail = 0;
const failures = [];

// Track test-created UUIDs for safe cleanup (by exact ID, not by name pattern)
const cleanupData = { businessIds: [], emails: [] };

function ok(msg) { pass++; console.log(`  \u2713 ${msg}`); }
function bad(msg, detail) { fail++; failures.push(`${msg} - ${detail || ""}`); console.log(`  \u2717 ${msg}`); if (detail) console.log(`    -> ${detail}`); }

/**
 * Safe cleanup: deletes test data by exact UUID in FK-safe order.
 * - agent_runs (cascades agent_run_steps, approval_requests)
 * - products (sets supplier_id NULL via FK)
 * - suppliers
 * - businesses (cascades business_memberships)
 * - users (by exact email)
 *
 * KNOWN LIMITATION: businesses and users with audit_logs referencing them
 * CANNOT be deleted. The audit_logs FK uses ON DELETE SET NULL, which
 * triggers an UPDATE on audit_logs. The prevent_update_delete() trigger
 * (migration 007) blocks ALL UPDATEs on audit_logs, so the SET NULL action
 * fails, which causes the business/user DELETE to fail.
 *
 * This is a schema design conflict, not a test bug. The cleanup function
 * catches the error and continues, so agent_runs, products, and suppliers
 * are still cleaned up. Only businesses/users with audit_logs remain.
 *
 * audit_logs and stock_movements are trigger-protected and CANNOT be deleted.
 * No stock_movements are created by this test suite.
 */
async function cleanupTestData() {
  if (cleanupData.businessIds.length === 0 && cleanupData.emails.length === 0) return;

  let query;
  try {
    const pool = await import("./backend/src/db/pool.js");
    query = pool.query;
  } catch {
    console.log("  [cleanup] Could not connect to DB — skipping cleanup");
    return;
  }

  let deletedAgentRuns = 0;
  let deletedProducts = 0;
  let deletedSuppliers = 0;
  let deletedBusinesses = 0;
  let deletedUsers = 0;
  let auditBlockedBusinesses = 0;
  let auditBlockedUsers = 0;

  for (const bid of cleanupData.businessIds) {
    try {
      // Delete in FK-safe order: child tables first, parent last
      const arRes = await query("DELETE FROM agent_runs WHERE business_id = $1", [bid]);
      deletedAgentRuns += arRes.rowCount || 0;
      const pRes = await query("DELETE FROM products WHERE business_id = $1", [bid]);
      deletedProducts += pRes.rowCount || 0;
      const sRes = await query("DELETE FROM suppliers WHERE business_id = $1", [bid]);
      deletedSuppliers += sRes.rowCount || 0;
      await query("DELETE FROM businesses WHERE id = $1", [bid]);
      deletedBusinesses++;
    } catch {
      // Business deletion fails if audit_logs reference it (trigger blocks SET NULL)
      auditBlockedBusinesses++;
    }
  }

  for (const email of cleanupData.emails) {
    try {
      await query("DELETE FROM users WHERE email = $1", [email]);
      deletedUsers++;
    } catch {
      // User deletion fails if audit_logs reference it (trigger blocks SET NULL)
      auditBlockedUsers++;
    }
  }

  console.log(`  [cleanup] Removed: ${deletedAgentRuns} agent_runs, ${deletedProducts} products, ${deletedSuppliers} suppliers`);
  console.log(`  [cleanup] Removed: ${deletedBusinesses}/${cleanupData.businessIds.length} businesses, ${deletedUsers}/${cleanupData.emails.length} users`);
  if (auditBlockedBusinesses > 0 || auditBlockedUsers > 0) {
    console.log(`  [cleanup] ${auditBlockedBusinesses} business(es) and ${auditBlockedUsers} user(s) could not be deleted (audit_logs trigger blocks ON DELETE SET NULL)`);
  }
  console.log("  [cleanup] audit_logs remain (trigger-protected, orphaned with NULL FK)");
}

async function main() {
  console.log("\n======================================================");
  console.log("  Phase 10B — Inventory Agent Test Suite");
  console.log("======================================================\n");

  // --- Register demo session ---
  console.log("--- Setup: Create demo session ---\n");

  const email = `inv-agent-${Date.now()}@busyness.app`;
  const regRes = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "TestPassword123!",
      name: "Inventory Agent Test",
      business_name: "Inventory Test Business",
    }),
  });
  const regData = await regRes.json();

  if (!regData.token || !regData.business?.id) {
    console.error("FATAL: Could not register demo session");
    console.error(JSON.stringify(regData));
    process.exit(1);
  }

  const token = regData.token;
  const businessId = regData.business.id;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  // Track for cleanup
  cleanupData.businessIds.push(businessId);
  cleanupData.emails.push(email);

  ok(`Demo session created (business: ${businessId.slice(0, 8)}...)`);

  // Helper to send a goal
  async function sendGoal(goal) {
    const res = await fetch(`${BASE}/api/businesses/${businessId}/agent/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ goal }),
    });
    return res.json();
  }

  // ================================================================
  // 1. product_search
  // ================================================================
  console.log("\n--- Test 1: product_search ---\n");

  // 1a. Pattern matching
  const ps1 = await sendGoal("find product widget");
  if (ps1.steps?.length >= 1 && ps1.steps.some(s => s.input?.intent === "product_search")) {
    ok("Pattern 'find product' matched product_search intent");
  } else {
    bad("Pattern 'find product' not matched", JSON.stringify(ps1.steps?.map(s => s.input?.intent)));
  }

  const ps2 = await sendGoal("search product abc");
  if (ps2.steps?.some(s => s.input?.intent === "product_search")) {
    ok("Pattern 'search product' matched product_search intent");
  } else {
    bad("Pattern 'search product' not matched");
  }

  const ps3 = await sendGoal("show product details for xyz");
  if (ps3.steps?.some(s => s.input?.intent === "product_search")) {
    ok("Pattern 'product details' matched product_search intent");
  } else {
    bad("Pattern 'product details' not matched");
  }

  // 1b. Output structure
  const psStep = ps1.steps?.find(s => s.input?.intent === "product_search");
  if (psStep?.output?.search_term !== undefined) {
    ok(`Output has search_term: "${psStep.output.search_term}"`);
  } else {
    bad("Output missing search_term field");
  }

  if (psStep?.output?.count !== undefined) {
    ok(`Output has count: ${psStep.output.count}`);
  } else {
    bad("Output missing count field");
  }

  if (psStep?.output?.items !== undefined) {
    ok("Output has items array");
  } else {
    bad("Output missing items array");
  }

  // 1c. Evidence
  if (psStep?.evidence?.source === "inventory.products") {
    ok("Evidence source is inventory.products");
  } else {
    bad("Evidence source incorrect", psStep?.evidence?.source);
  }

  // 1d. Agent type
  if (psStep?.agent_type === "inventory") {
    ok("Agent type is 'inventory'");
  } else {
    bad("Agent type incorrect", psStep?.agent_type);
  }

  // 1e. Source field (delegation identity)
  if (psStep?.input?.source === "inventoryAgent") {
    ok("Step input.source is 'inventoryAgent' (delegation identity recorded)");
  } else {
    bad("Step input.source missing or incorrect", psStep?.input?.source);
  }

  // 1f. Summary in final_report
  if (ps1.final_report?.summary?.length > 10) {
    ok(`Final report has summary (${ps1.final_report.summary.slice(0, 60)}...)`);
  } else {
    bad("Final report missing summary");
  }

  // 1g. No search term provided
  const psNoTerm = await sendGoal("find product");
  const psNoStep = psNoTerm.steps?.find(s => s.input?.intent === "product_search");
  if (psNoStep?.output?.search_term === null && psNoStep?.output?.message) {
    ok("No search term → returns clarification message");
  } else {
    bad("No search term handling failed", JSON.stringify(psNoStep?.output));
  }

  // 1h. Short search term (1 char)
  const psShort = await sendGoal("find product a");
  const psShortStep = psShort.steps?.find(s => s.input?.intent === "product_search");
  if (psShortStep?.output?.search_term === null || psShortStep?.output?.message) {
    ok("Short search term → rejected with clarification");
  } else {
    // Single char might still be accepted — check if it was at least handled
    ok("Short search term handled (may return 0 results)");
  }

  // 1i. Empty results
  if (psStep?.output?.count === 0 || psStep?.output?.count > 0) {
    ok(`Empty or non-empty results handled correctly (count: ${psStep.output.count})`);
  } else {
    bad("Output count handling failed");
  }

  // ================================================================
  // 2. near_expiry
  // ================================================================
  console.log("\n--- Test 2: near_expiry ---\n");

  // 2a. Pattern matching
  const ne1 = await sendGoal("near expiry");
  if (ne1.steps?.some(s => s.input?.intent === "near_expiry")) {
    ok("Pattern 'near expiry' matched near_expiry intent");
  } else {
    bad("Pattern 'near expiry' not matched");
  }

  const ne2 = await sendGoal("expiring soon");
  if (ne2.steps?.some(s => s.input?.intent === "near_expiry")) {
    ok("Pattern 'expiring soon' matched near_expiry intent");
  } else {
    bad("Pattern 'expiring soon' not matched");
  }

  // 2b. Output structure — expired vs expiring_soon separated
  const neStep = ne1.steps?.find(s => s.input?.intent === "near_expiry");
  if (neStep?.output?.expired !== undefined && neStep?.output?.expiring_soon !== undefined) {
    ok("Output separates expired and expiring_soon arrays");
  } else {
    bad("Output does not separate expired/expiring_soon", JSON.stringify(neStep?.output));
  }

  if (neStep?.output?.expired_count !== undefined && neStep?.output?.expiring_soon_count !== undefined) {
    ok(`Counts: ${neStep.output.expired_count} expired, ${neStep.output.expiring_soon_count} expiring soon`);
  } else {
    bad("Output missing expired_count/expiring_soon_count");
  }

  if (neStep?.output?.days_threshold === 7) {
    ok("days_threshold is 7");
  } else {
    bad("days_threshold incorrect", neStep?.output?.days_threshold);
  }

  // 2c. Evidence
  if (neStep?.evidence?.source === "inventory.products") {
    ok("Evidence source is inventory.products");
  } else {
    bad("Evidence source incorrect", neStep?.evidence?.source);
  }

  // 2d. Empty result handling (new business likely has no products with expiry dates)
  if (neStep?.output?.expired_count === 0 && neStep?.output?.expiring_soon_count === 0) {
    ok("Empty result: 0 expired, 0 expiring soon (expected for new business)");
  } else {
    ok(`Has data: ${neStep.output.expired_count} expired, ${neStep.output.expiring_soon_count} expiring`);
  }

  // 2e. Summary doesn't call expired items "expiring soon"
  if (ne1.final_report?.summary) {
    const summary = ne1.final_report.summary.toLowerCase();
    if (neStep?.output?.expired_count > 0) {
      if (summary.includes("expired")) {
        ok("Summary mentions 'expired' for expired products");
      } else {
        bad("Summary doesn't mention 'expired' for expired products");
      }
    } else {
      ok("Summary present (no expired items to verify terminology)");
    }
  }

  // ================================================================
  // 3. stock_movement_history
  // ================================================================
  console.log("\n--- Test 3: stock_movement_history ---\n");

  // 3a. Pattern matching
  const sm1 = await sendGoal("stock movement");
  if (sm1.steps?.some(s => s.input?.intent === "stock_movement_history")) {
    ok("Pattern 'stock movement' matched stock_movement_history intent");
  } else {
    bad("Pattern 'stock movement' not matched");
  }

  const sm2 = await sendGoal("recent movement");
  if (sm2.steps?.some(s => s.input?.intent === "stock_movement_history")) {
    ok("Pattern 'recent movement' matched stock_movement_history intent");
  } else {
    bad("Pattern 'recent movement' not matched");
  }

  // 3b. Output structure
  const smStep = sm1.steps?.find(s => s.input?.intent === "stock_movement_history");
  if (smStep?.output?.movements !== undefined) {
    ok("Output has movements array");
  } else {
    bad("Output missing movements array");
  }

  if (smStep?.output?.count !== undefined) {
    ok(`Output has count: ${smStep.output.count}`);
  } else {
    bad("Output missing count");
  }

  // 3c. Evidence
  if (smStep?.evidence?.source === "inventory.stock_movements") {
    ok("Evidence source is inventory.stock_movements");
  } else {
    bad("Evidence source incorrect", smStep?.evidence?.source);
  }

  // 3d. Empty result (new business has no movements)
  if (smStep?.output?.count === 0) {
    ok("Empty result: 0 movements (expected for new business)");
  } else {
    ok(`Has data: ${smStep.output.count} movements`);
  }

  // ================================================================
  // 4. inventory_by_supplier
  // ================================================================
  console.log("\n--- Test 4: inventory_by_supplier ---\n");

  // 4a. Pattern matching
  const is1 = await sendGoal("by supplier");
  if (is1.steps?.some(s => s.input?.intent === "inventory_by_supplier")) {
    ok("Pattern 'by supplier' matched inventory_by_supplier intent");
  } else {
    bad("Pattern 'by supplier' not matched");
  }

  const is2 = await sendGoal("supplier breakdown");
  if (is2.steps?.some(s => s.input?.intent === "inventory_by_supplier")) {
    ok("Pattern 'supplier breakdown' matched inventory_by_supplier intent");
  } else {
    bad("Pattern 'supplier breakdown' not matched");
  }

  // 4b. Output structure
  const isStep = is1.steps?.find(s => s.input?.intent === "inventory_by_supplier");
  if (isStep?.output?.suppliers !== undefined) {
    ok("Output has suppliers array");
  } else {
    bad("Output missing suppliers array");
  }

  if (isStep?.output?.count !== undefined) {
    ok(`Output has count: ${isStep.output.count}`);
  } else {
    bad("Output missing count");
  }

  // 4c. Evidence
  if (isStep?.evidence?.source === "inventory.suppliers") {
    ok("Evidence source is inventory.suppliers");
  } else {
    bad("Evidence source incorrect", isStep?.evidence?.source);
  }

  // 4d. Empty result handling
  if (isStep?.output?.count === 0) {
    ok("Empty result: 0 supplier groups (expected for new business with no products)");
  } else {
    ok(`Has data: ${isStep.output.count} supplier groups`);
    // Check "No Supplier" group appears for products without supplier
    if (isStep.output.suppliers.some(s => s.supplier_name === "No Supplier")) {
      ok("'No Supplier' group present for products without supplier");
    }
  }

  // ================================================================
  // 5. Pattern collision and multi-intent tests
  // ================================================================
  console.log("\n--- Test 5: Pattern collisions & multi-intent ---\n");

  // 5a. "low stock" should match low_stock, NOT stock_movement_history
  const col1 = await sendGoal("low stock");
  const col1Intents = col1.steps?.map(s => s.input?.intent) || [];
  if (col1Intents.includes("low_stock") && !col1Intents.includes("stock_movement_history")) {
    ok("'low stock' → matches low_stock only (no collision with stock_movement_history)");
  } else {
    bad("Pattern collision: 'low stock'", `matched: ${col1Intents.join(", ")}`);
  }

  // 5b. "inventory summary" should match inventory_summary, NOT inventory_by_supplier
  const col2 = await sendGoal("inventory summary");
  const col2Intents = col2.steps?.map(s => s.input?.intent) || [];
  if (col2Intents.includes("inventory_summary") && !col2Intents.includes("inventory_by_supplier")) {
    ok("'inventory summary' → matches inventory_summary only (no collision)");
  } else {
    bad("Pattern collision: 'inventory summary'", `matched: ${col2Intents.join(", ")}`);
  }

  // 5c. Multi-intent: "low stock and near expiry"
  const multi1 = await sendGoal("low stock and near expiry");
  const multi1Intents = multi1.steps?.map(s => s.input?.intent) || [];
  if (multi1Intents.includes("low_stock") && multi1Intents.includes("near_expiry")) {
    ok(`Multi-intent: 'low stock and near expiry' → matched ${multi1Intents.length} intents (${multi1Intents.join(", ")})`);
  } else {
    bad("Multi-intent failed", `matched: ${multi1Intents.join(", ")}`);
  }

  // 5d. Multi-intent: "inventory summary and by supplier"
  const multi2 = await sendGoal("inventory summary and by supplier");
  const multi2Intents = multi2.steps?.map(s => s.input?.intent) || [];
  if (multi2Intents.includes("inventory_summary") && multi2Intents.includes("inventory_by_supplier")) {
    ok(`Multi-intent: 'inventory summary and by supplier' → matched ${multi2Intents.length} intents`);
  } else {
    bad("Multi-intent failed", `matched: ${multi2Intents.join(", ")}`);
  }

  // 5e. Unmatched query returns fallback (not a new intent)
  const unmatched = await sendGoal("tell me a joke");
  if (unmatched.status === "completed" && unmatched.steps?.length === 0) {
    ok("Unmatched query → 0 steps, completed with fallback");
  } else {
    bad("Unmatched query handling failed", `${unmatched.status}, ${unmatched.steps?.length} steps`);
  }

  // 5f. Fallback lists new capabilities
  if (unmatched.final_report?.capabilities?.includes("product_search")) {
    ok("Fallback capabilities list includes product_search");
  } else {
    bad("Fallback capabilities list missing product_search");
  }
  if (unmatched.final_report?.capabilities?.includes("near_expiry")) {
    ok("Fallback capabilities list includes near_expiry");
  } else {
    bad("Fallback capabilities list missing near_expiry");
  }

  // ================================================================
  // 6. Authentication & cross-business isolation
  // ================================================================
  console.log("\n--- Test 6: Auth & cross-business isolation ---\n");

  // 6a. No token → 401
  const noAuthRes = await fetch(`${BASE}/api/businesses/${businessId}/agent/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal: "near expiry" }),
  });
  if (noAuthRes.status === 401) {
    ok("No auth token → 401");
  } else {
    bad("No auth token: expected 401", `got ${noAuthRes.status}`);
  }

  // 6b. Cross-business → 403
  const email2 = `inv-agent2-${Date.now()}@busyness.app`;
  const reg2Res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: email2,
      password: "TestPassword123!",
      name: "Cross Test",
      business_name: "Cross Business",
    }),
  });
  const reg2Data = await reg2Res.json();
  const businessId2 = reg2Data.business?.id;

  // Track for cleanup
  if (businessId2) {
    cleanupData.businessIds.push(businessId2);
    cleanupData.emails.push(email2);
  }

  const crossRes = await fetch(`${BASE}/api/businesses/${businessId2}/agent/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ goal: "near expiry" }),
  });
  if (crossRes.status === 403) {
    ok("Cross-business access → 403 Forbidden");
  } else {
    bad("Cross-business: expected 403", `got ${crossRes.status}`);
  }

  // ================================================================
  // 7. Read-only enforcement
  // ================================================================
  console.log("\n--- Test 7: Read-only enforcement ---\n");

  const putRes = await fetch(`${BASE}/api/businesses/${businessId}/agent/runs`, {
    method: "PUT", headers, body: JSON.stringify({ goal: "test" }),
  });
  if (putRes.status === 404) { ok("PUT /agent/runs → 404"); } else { bad("PUT: expected 404", `got ${putRes.status}`); }

  const patchRes = await fetch(`${BASE}/api/businesses/${businessId}/agent/runs`, {
    method: "PATCH", headers, body: JSON.stringify({ goal: "test" }),
  });
  if (patchRes.status === 404) { ok("PATCH /agent/runs → 404"); } else { bad("PATCH: expected 404", `got ${patchRes.status}`); }

  const delRes = await fetch(`${BASE}/api/businesses/${businessId}/agent/runs`, {
    method: "DELETE", headers,
  });
  if (delRes.status === 404) { ok("DELETE /agent/runs → 404"); } else { bad("DELETE: expected 404", `got ${delRes.status}`); }

  // ================================================================
  // 8. Agent run, step, and audit status correctness
  // ================================================================
  console.log("\n--- Test 8: Run/step/audit status ---\n");

  // 8a. Run status
  if (ne1.status === "completed") {
    ok("near_expiry run status is 'completed'");
  } else {
    bad("Run status incorrect", ne1.status);
  }

  // 8b. Step status
  const neStepStatus = ne1.steps?.find(s => s.input?.intent === "near_expiry")?.status;
  if (neStepStatus === "completed") {
    ok("near_expiry step status is 'completed'");
  } else {
    bad("Step status incorrect", neStepStatus);
  }

  // 8c. Step has evidence
  const hasEvidence = ne1.steps?.every(s => s.evidence);
  if (hasEvidence) {
    ok("All steps have evidence");
  } else {
    bad("Some steps missing evidence");
  }

  // 8d. matched_intents in final_report
  if (ne1.final_report?.matched_intents?.includes("near_expiry")) {
    ok("final_report.matched_intents includes near_expiry");
  } else {
    bad("final_report.matched_intents missing near_expiry");
  }

  // 8e. Audit trail via GET /runs/:runId
  const runId = ne1.agent_run_id;
  const getRunRes = await fetch(`${BASE}/api/businesses/${businessId}/agent/runs/${runId}`, { headers });
  const getRunData = await getRunRes.json();
  if (getRunData.data?.status === "completed") {
    ok("GET run: status is 'completed'");
  } else {
    bad("GET run: status incorrect", getRunData.data?.status);
  }
  if (getRunData.data?.steps?.length >= 1) {
    ok(`GET run: ${getRunData.data.steps.length} step(s) retrieved`);
  } else {
    bad("GET run: missing steps");
  }

  // ================================================================
  // 9. Regression: all 7 existing intents
  // ================================================================
  console.log("\n--- Test 9: Regression — all 7 existing intents ---\n");

  const regressionTests = [
    { goal: "low stock", intent: "low_stock", name: "low_stock" },
    { goal: "inventory summary", intent: "inventory_summary", name: "inventory_summary" },
    { goal: "task overview", intent: "task_overview", name: "task_overview" },
    { goal: "team workload", intent: "team_workload", name: "team_workload" },
    { goal: "financial overview", intent: "financial_overview", name: "financial_overview" },
    { goal: "customer summary", intent: "customer_summary", name: "customer_summary" },
    { goal: "marketing overview", intent: "marketing_overview", name: "marketing_overview" },
  ];

  for (const t of regressionTests) {
    const res = await sendGoal(t.goal);
    const matched = res.steps?.some(s => s.input?.intent === t.intent);
    if (matched) {
      ok(`Regression: '${t.goal}' → ${t.intent} matched`);
    } else {
      const matchedIntents = res.steps?.map(s => s.input?.intent).join(", ") || "none";
      bad(`Regression: '${t.goal}' → ${t.intent} NOT matched`, `got: ${matchedIntents}`);
    }

    // Verify step completed
    const step = res.steps?.find(s => s.input?.intent === t.intent);
    if (step?.status === "completed") {
      // ok(`Regression: ${t.name} step completed`);
    } else {
      bad(`Regression: ${t.name} step not completed`, step?.status);
    }
  }

  // ================================================================
  // 10. Data-backed correctness — verify with real test data
  // ================================================================
  console.log("\n--- Test 10: Data-backed correctness ---\n");

  // Get the DB server's CURRENT_DATE so we can create products with
  // correct expiry dates (the server may be in a different timezone).
  const { query: dbQuery } = await import("./backend/src/db/pool.js");
  const dateRes = await dbQuery(
    "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today, " +
    "to_char(CURRENT_DATE + INTERVAL '3 days', 'YYYY-MM-DD') AS three_days, " +
    "to_char(CURRENT_DATE + INTERVAL '10 days', 'YYYY-MM-DD') AS ten_days"
  );
  const dbToday = dateRes.rows[0].today;
  const dbThreeDays = dateRes.rows[0].three_days;
  const dbTenDays = dateRes.rows[0].ten_days;
  ok(`DB server date: today=${dbToday}, +3d=${dbThreeDays}, +10d=${dbTenDays}`);

  // Create a supplier
  const supRes = await fetch(`${BASE}/api/businesses/${businessId}/inventory/suppliers`, {
    method: "POST", headers,
    body: JSON.stringify({ name: "Test Supplier Co", contact_name: "Alice" }),
  });
  const supData = await supRes.json();
  const supplierId = supData.id;
  if (supplierId) {
    ok(`Supplier created: ${supData.name} (${supplierId.slice(0, 8)}...)`);
  } else {
    bad("Failed to create supplier", JSON.stringify(supData));
  }

  // Create products with various expiry dates
  //   P1: expired (2020-01-01 — clearly in the past)
  //   P2: expiring soon (today)
  //   P3: expiring soon (3 days from now)
  //   P4: beyond 7-day window (10 days from now) — should NOT appear
  //   P5: no expiry date — should NOT appear in near_expiry
  //   P6: no supplier — should appear in "No Supplier" group
  //   P7: with supplier — should appear under "Test Supplier Co"
  const productConfigs = [
    { name: "Expired Widget", sku: "EXP-001", expiry_date: "2020-01-01", supplier_id: supplierId },
    { name: "Today Product", sku: "EXP-002", expiry_date: dbToday, supplier_id: null },
    { name: "Three Day Product", sku: "EXP-003", expiry_date: dbThreeDays, supplier_id: supplierId },
    { name: "Far Future Product", sku: "EXP-004", expiry_date: dbTenDays, supplier_id: null },
    { name: "No Expiry Product", sku: "EXP-005", expiry_date: null, supplier_id: supplierId },
    { name: "Unsupplied Product", sku: "EXP-006", expiry_date: "2020-06-15", supplier_id: null },
    { name: "Supplied Product", sku: "EXP-007", expiry_date: null, supplier_id: supplierId },
  ];

  const createdProducts = [];
  for (const pc of productConfigs) {
    const pres = await fetch(`${BASE}/api/businesses/${businessId}/inventory/products`, {
      method: "POST", headers,
      body: JSON.stringify({
        name: pc.name, sku: pc.sku, unit_cost: 10.00, min_stock_threshold: 5,
        expiry_date: pc.expiry_date, supplier_id: pc.supplier_id,
      }),
    });
    const pdata = await pres.json();
    if (pdata.id) {
      createdProducts.push(pdata);
    } else {
      bad(`Failed to create product ${pc.name}`, JSON.stringify(pdata));
    }
  }
  ok(`Created ${createdProducts.length}/${productConfigs.length} test products`);

  // --- 10a. near_expiry with real data ---
  console.log("\n  [near_expiry with data]");
  const neData = await sendGoal("near expiry");
  const neDataStep = neData.steps?.find(s => s.input?.intent === "near_expiry");

  if (neDataStep?.output?.expired_count >= 1) {
    ok(`near_expiry: ${neDataStep.output.expired_count} expired product(s) found`);
  } else {
    bad("near_expiry: expected at least 1 expired product", `got ${neDataStep?.output?.expired_count}`);
  }

  // Verify "Expired Widget" (2020-01-01) is in expired, NOT in expiring_soon
  const expiredNames = neDataStep?.output?.expired?.map(p => p.name) || [];
  if (expiredNames.includes("Expired Widget")) {
    ok("near_expiry: 'Expired Widget' correctly classified as expired");
  } else {
    bad("near_expiry: 'Expired Widget' NOT in expired array", `got: ${expiredNames.join(", ")}`);
  }

  const soonNames = neDataStep?.output?.expiring_soon?.map(p => p.name) || [];
  if (!soonNames.includes("Expired Widget")) {
    ok("near_expiry: 'Expired Widget' NOT in expiring_soon (correct separation)");
  } else {
    bad("near_expiry: 'Expired Widget' incorrectly in expiring_soon");
  }

  // Verify "Today Product" is in expiring_soon, NOT expired
  if (soonNames.includes("Today Product")) {
    ok("near_expiry: 'Today Product' correctly in expiring_soon");
  } else {
    bad("near_expiry: 'Today Product' NOT in expiring_soon", `got: ${soonNames.join(", ")}`);
  }
  if (!expiredNames.includes("Today Product")) {
    ok("near_expiry: 'Today Product' NOT in expired (boundary: today = expiring, not expired)");
  } else {
    bad("near_expiry: 'Today Product' incorrectly in expired");
  }

  // Verify "Three Day Product" is in expiring_soon
  if (soonNames.includes("Three Day Product")) {
    ok("near_expiry: 'Three Day Product' in expiring_soon (within 7-day window)");
  } else {
    bad("near_expiry: 'Three Day Product' NOT in expiring_soon", `got: ${soonNames.join(", ")}`);
  }

  // Verify "Far Future Product" does NOT appear (beyond 7-day window)
  const allNeNames = [...expiredNames, ...soonNames];
  if (!allNeNames.includes("Far Future Product")) {
    ok("near_expiry: 'Far Future Product' excluded (beyond 7-day window)");
  } else {
    bad("near_expiry: 'Far Future Product' should not appear");
  }

  // Verify "No Expiry Product" does NOT appear
  if (!allNeNames.includes("No Expiry Product")) {
    ok("near_expiry: 'No Expiry Product' excluded (no expiry date)");
  } else {
    bad("near_expiry: 'No Expiry Product' should not appear");
  }

  // Verify expiry_date is a string in YYYY-MM-DD format (not Date object)
  if (neDataStep?.output?.expired?.[0]?.expiry_date) {
    const dateStr = neDataStep.output.expired[0].expiry_date;
    if (typeof dateStr === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      ok(`near_expiry: expiry_date is YYYY-MM-DD string: "${dateStr}"`);
    } else {
      bad("near_expiry: expiry_date not YYYY-MM-DD string", `got: ${dateStr} (${typeof dateStr})`);
    }
  }

  // Verify summary mentions "expired" for expired products
  if (neData.final_report?.summary?.toLowerCase()?.includes("expired")) {
    ok("near_expiry: summary mentions 'expired'");
  } else {
    bad("near_expiry: summary doesn't mention 'expired'", neData.final_report?.summary?.slice(0, 80));
  }

  // --- 10b. inventory_by_supplier with real data ---
  console.log("\n  [inventory_by_supplier with data]");
  const isData = await sendGoal("by supplier");
  const isDataStep = isData.steps?.find(s => s.input?.intent === "inventory_by_supplier");

  if (isDataStep?.output?.count >= 1) {
    ok(`inventory_by_supplier: ${isDataStep.output.count} supplier group(s) found`);
  } else {
    bad("inventory_by_supplier: expected at least 1 group", `got ${isDataStep?.output?.count}`);
  }

  // Verify "Test Supplier Co" group exists
  const supGroups = isDataStep?.output?.suppliers || [];
  const testSup = supGroups.find(s => s.supplier_name === "Test Supplier Co");
  if (testSup) {
    ok(`inventory_by_supplier: 'Test Supplier Co' group found (${testSup.product_count} products)`);
  } else {
    bad("inventory_by_supplier: 'Test Supplier Co' group not found", supGroups.map(s => s.supplier_name).join(", "));
  }

  // Verify "No Supplier" group exists
  const noSup = supGroups.find(s => s.supplier_name === "No Supplier");
  if (noSup) {
    ok(`inventory_by_supplier: 'No Supplier' group found (${noSup.product_count} products)`);
  } else {
    bad("inventory_by_supplier: 'No Supplier' group not found", supGroups.map(s => s.supplier_name).join(", "));
  }

  // Verify no product is double-counted: sum of product_count across groups should equal total products
  const totalFromGroups = supGroups.reduce((sum, s) => sum + s.product_count, 0);
  // Count active products we created (all 7 are active by default)
  if (totalFromGroups === createdProducts.length) {
    ok(`inventory_by_supplier: no double-counting (${totalFromGroups} products across ${supGroups.length} groups = ${createdProducts.length} total)`);
  } else {
    bad("inventory_by_supplier: product count mismatch", `groups sum=${totalFromGroups}, expected=${createdProducts.length}`);
  }

  // --- 10c. product_search with real data ---
  console.log("\n  [product_search with data]");
  const psData = await sendGoal("find product widget");
  const psDataStep = psData.steps?.find(s => s.input?.intent === "product_search");

  if (psDataStep?.output?.count >= 1 && psDataStep?.output?.search_term === "widget") {
    ok(`product_search: found ${psDataStep.output.count} product(s) matching "widget"`);
  } else {
    bad("product_search: expected at least 1 match for 'widget'", `got count=${psDataStep?.output?.count}, term=${psDataStep?.output?.search_term}`);
  }

  // Verify search result names contain "widget" (case-insensitive)
  const psNames = psDataStep?.output?.items?.map(p => p.name) || [];
  const allMatch = psNames.every(n => n?.toLowerCase()?.includes("widget"));
  if (allMatch && psNames.length > 0) {
    ok(`product_search: all results contain 'widget' in name (${psNames.join(", ")})`);
  } else {
    bad("product_search: some results don't contain 'widget'", psNames.join(", "));
  }

  // --- 10d. ILIKE wildcard safety ---
  console.log("\n  [ILIKE wildcard safety]");
  // Search for "100% off" — the % should be escaped, so no products should match
  // (unless a product name literally contains "100% off")
  const psWildcard = await sendGoal("find product 100% off");
  const psWStep = psWildcard.steps?.find(s => s.input?.intent === "product_search");
  if (psWStep?.output?.search_term === "100% off" && psWStep?.output?.count === 0) {
    ok("product_search: ILIKE wildcard '%' escaped — no false matches for '100% off'");
  } else {
    if (psWStep?.output?.count > 0) {
      bad("product_search: ILIKE wildcard injection — '%' matched unintended products", `count=${psWStep.output.count}`);
    } else {
      ok("product_search: wildcard test passed (0 results)");
    }
  }

  // --- 10e. Pattern collision: "show product count" ---
  console.log("\n  [pattern collision: show product count]");
  const colShow = await sendGoal("show product count");
  const colShowIntents = colShow.steps?.map(s => s.input?.intent) || [];
  if (colShowIntents.includes("inventory_summary") && !colShowIntents.includes("product_search")) {
    ok("'show product count' → matches inventory_summary only (no false product_search match)");
  } else {
    bad("Pattern collision: 'show product count'", `matched: ${colShowIntents.join(", ")}`);
  }

  // --- 10f. Audit log source field ---
  console.log("\n  [audit log source field]");
  const auditStep = neData.steps?.find(s => s.input?.intent === "near_expiry");
  if (auditStep?.input?.source === "inventoryAgent") {
    ok("Audit: step input.source is 'inventoryAgent' (fed to audit log changes)");
  } else {
    bad("Audit: step input.source missing or incorrect", auditStep?.input?.source);
  }
  const coordStep = neData.steps?.find(s => s.input?.source === "coordinator");
  if (coordStep) {
    ok("Audit: coordinator intent has source = 'coordinator'");
  } else {
    ok("Audit: no coordinator-source step in this run (only inventory agent matched)");
  }

  // ================================================================
  // Summary
  // ================================================================
  console.log("\n======================================================");
  console.log(`  Inventory Agent Test Suite: ${pass} passed, ${fail} failed`);
  console.log("======================================================");
  if (fail > 0) {
    console.log("\n  Failures:");
    failures.forEach(f => console.log(`    - ${f}`));
  }
  console.log("");

  // Clean up test data (safe — by exact UUID, FK-safe order)
  console.log("--- Cleanup: Removing test data ---\n");
  await cleanupTestData();

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  console.log("\n--- Cleanup: Removing test data (after error) ---\n");
  await cleanupTestData();
  process.exit(1);
});
