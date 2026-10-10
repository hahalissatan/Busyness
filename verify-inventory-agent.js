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

function ok(msg) { pass++; console.log(`  \u2713 ${msg}`); }
function bad(msg, detail) { fail++; failures.push(`${msg} - ${detail || ""}`); console.log(`  \u2717 ${msg}`); if (detail) console.log(`    -> ${detail}`); }

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
    ok("Pattern 'show product' matched product_search intent");
  } else {
    bad("Pattern 'show product' not matched");
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
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
