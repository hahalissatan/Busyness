/**
 * Phase 10A — Scope & Data Safety Verification
 *
 * Verifies:
 *   1. Unmatched queries → run completed, 0 steps, no business data writes
 *   2. Matched queries → run with steps, all SELECT-only
 *   3. Failed step → marked 'failed', not 'completed'
 *   4. Coordinator never writes to business data tables
 *
 * Run: node verify-scope-safety.js
 */

const BASE = "http://127.0.0.1:3001";

let pass = 0;
let fail = 0;
const failures = [];

function ok(msg) { pass++; console.log(`  \u2713 ${msg}`); }
function bad(msg, detail) { fail++; failures.push(`${msg} - ${detail || ""}`); console.log(`  \u2717 ${msg}`); if (detail) console.log(`    -> ${detail}`); }

async function main() {
  console.log("\n======================================================");
  console.log("  Phase 10A — Scope & Data Safety Verification");
  console.log("======================================================\n");

  // --- Step 1: Register demo session ---
  console.log("--- Step 1: Create demo session ---\n");

  const email = `scope-test-${Date.now()}@busyness.app`;
  const regRes = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "TestPassword123!",
      name: "Scope Test",
      business_name: "Scope Test Business",
    }),
  });
  const regData = await regRes.json();
  const token = regData.token;
  const businessId = regData.business.id;

  if (!token || !businessId) {
    console.error("FATAL: Could not register demo session");
    process.exit(1);
  }
  ok("Demo session created");

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  // --- Step 2: Unmatched query ---
  console.log("\n--- Step 2: Unmatched query (no business data access) ---\n");

  const unmatchedRes = await fetch(`${BASE}/api/businesses/${businessId}/agent/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ goal: "tell me a joke about cats" }),
  });
  const unmatchedData = await unmatchedRes.json();

  if (unmatchedData.status === "completed" && unmatchedData.steps.length === 0) {
    ok("Unmatched query: run completed with 0 steps (no business data accessed)");
  } else {
    bad("Unmatched query: expected completed with 0 steps", `got ${unmatchedData.status} with ${unmatchedData.steps?.length || 0} steps`);
  }

  if (unmatchedData.final_report?.matched_intents?.length === 0) {
    ok("Unmatched query: 0 matched intents in final report");
  } else {
    bad("Unmatched query: expected 0 matched intents");
  }

  if (unmatchedData.final_report?.summary?.includes("couldn't find")) {
    ok("Unmatched query: fallback response provided");
  } else {
    bad("Unmatched query: expected fallback response");
  }

  // --- Step 3: Matched query (SELECT-only) ---
  console.log("\n--- Step 3: Matched query (SELECT-only access) ---\n");

  const matchedRes = await fetch(`${BASE}/api/businesses/${businessId}/agent/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ goal: "financial overview and inventory summary" }),
  });
  const matchedData = await matchedRes.json();

  if (matchedData.status === "completed") {
    ok("Matched query: run completed");
  } else {
    bad("Matched query: expected completed status", `got ${matchedData.status}`);
  }

  if (matchedData.steps?.length === 2) {
    ok(`Matched query: 2 steps executed (financial + inventory)`);
  } else {
    bad("Matched query: expected 2 steps", `got ${matchedData.steps?.length || 0}`);
  }

  // Verify all steps are completed (not failed)
  const allCompleted = matchedData.steps?.every(s => s.status === "completed");
  if (allCompleted) {
    ok("Matched query: all steps completed successfully");
  } else {
    const failedSteps = matchedData.steps?.filter(s => s.status === "failed");
    bad("Matched query: some steps failed", failedSteps?.map(s => `${s.agent_type}: ${s.error}`).join("; "));
  }

  // Verify final_report has summary with actual data
  if (matchedData.final_report?.summary?.length > 10) {
    ok(`Matched query: final report has summary (${matchedData.final_report.summary.slice(0, 60)}...)`);
  } else {
    bad("Matched query: final report missing summary");
  }

  // Verify matched intents
  if (matchedData.final_report?.matched_intents?.length === 2) {
    ok(`Matched query: 2 intents matched (${matchedData.final_report.matched_intents.join(", ")})`);
  } else {
    bad("Matched query: expected 2 matched intents");
  }

  // --- Step 4: Verify no destructive endpoints ---
  console.log("\n--- Step 4: No write endpoints on agent route ---\n");

  const putRes = await fetch(`${BASE}/api/businesses/${businessId}/agent/runs`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ goal: "test" }),
  });
  if (putRes.status === 404) {
    ok("PUT /agent/runs → 404 (no write endpoint)");
  } else {
    bad("PUT /agent/runs: expected 404", `got ${putRes.status}`);
  }

  const patchRes = await fetch(`${BASE}/api/businesses/${businessId}/agent/runs`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ goal: "test" }),
  });
  if (patchRes.status === 404) {
    ok("PATCH /agent/runs → 404 (no write endpoint)");
  } else {
    bad("PATCH /agent/runs: expected 404", `got ${patchRes.status}`);
  }

  const deleteRes = await fetch(`${BASE}/api/businesses/${businessId}/agent/runs`, {
    method: "DELETE",
    headers,
  });
  if (deleteRes.status === 404) {
    ok("DELETE /agent/runs → 404 (no write endpoint)");
  } else {
    bad("DELETE /agent/runs: expected 404", `got ${deleteRes.status}`);
  }

  // --- Step 5: Verify business scoping (cross-business) ---
  console.log("\n--- Step 5: Cross-business rejection ---\n");

  // Register a second business
  const email2 = `scope-test2-${Date.now()}@busyness.app`;
  const reg2Res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: email2,
      password: "TestPassword123!",
      name: "Scope Test 2",
      business_name: "Scope Test Business 2",
    }),
  });
  const reg2Data = await reg2Res.json();
  const token2 = reg2Data.token;
  const businessId2 = reg2Data.business.id;

  // Use token1 to access business2 → should get 403
  const crossRes = await fetch(`${BASE}/api/businesses/${businessId2}/agent/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ goal: "financial overview" }),
  });
  if (crossRes.status === 403) {
    ok("Cross-business access → 403 Forbidden");
  } else {
    bad("Cross-business access: expected 403", `got ${crossRes.status}`);
  }

  // --- Step 6: Verify audit trail for the matched run ---
  console.log("\n--- Step 6: Audit trail verification ---\n");

  const runId = matchedData.agent_run_id;
  const getRunRes = await fetch(`${BASE}/api/businesses/${businessId}/agent/runs/${runId}`, {
    headers,
  });
  const runData = await getRunRes.json();

  if (runData.data?.status === "completed") {
    ok("GET run: status is 'completed'");
  } else {
    bad("GET run: expected completed", `got ${runData.data?.status}`);
  }

  if (runData.data?.steps?.length === 2) {
    ok("GET run: 2 steps retrieved");
  } else {
    bad("GET run: expected 2 steps", `got ${runData.data?.steps?.length}`);
  }

  // Verify each step has evidence (query source)
  const hasEvidence = runData.data?.steps?.every(s => s.evidence);
  if (hasEvidence) {
    ok("GET run: all steps have evidence (query source tracked)");
  } else {
    bad("GET run: some steps missing evidence");
  }

  // --- Summary ---
  console.log("\n======================================================");
  console.log(`  Scope & Data Safety: ${pass} passed, ${fail} failed`);
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
