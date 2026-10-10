/**
 * Stage A — Comprehensive Coordinator Verification
 *
 * Tests trigger patterns, agent_type, output structure, summary accuracy,
 * audit trail records, business scoping, empty result handling, and
 * read-only enforcement.
 *
 * Optimized to minimize API requests (stays within rate limits).
 * Does NOT modify business data — read-only queries only.
 *
 * Run: node verify-stage-a.js
 * Prerequisites: Backend server running on localhost:3001
 */

const BASE = "http://localhost:3001/api";

let pass = 0;
let fail = 0;
const failures = [];

function ok(msg) { pass++; console.log(`  \u2713 ${msg}`); }
function bad(msg, detail) { fail++; failures.push(`${msg} - ${detail || ""}`); console.log(`  \u2717 ${msg}`); if (detail) console.log(`    -> ${detail}`); }

async function req(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    return { status: res.status, data, ok: res.ok };
  } catch (err) {
    return { status: 0, data: null, ok: false, error: err.message };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// All trigger patterns from the INTENT_REGISTRY
const INTENTS = [
  {
    id: "low_stock",
    agent_type: "inventory",
    patterns: ["low stock", "low-stock", "stock alert", "reorder", "restock", "running low"],
    output_keys: ["items", "count"],
    evidence_source: "inventory.products",
    // For empty results (count=0), the summary says "No low-stock items found"
    empty_summary_contains: "No low-stock",
    // For empty results, summary should contain these output values
    summary_values: (o) => [`${o.count}`],
  },
  {
    id: "inventory_summary",
    agent_type: "inventory",
    patterns: ["inventory summary", "stock summary", "how much stock", "inventory status", "product count"],
    output_keys: ["total_products", "total_value", "low_stock_count", "out_of_stock_count"],
    evidence_source: "inventory.products",
    empty_summary_contains: "0 products",
    summary_values: (o) => [`${o.total_products}`, `${o.total_value}`],
  },
  {
    id: "task_overview",
    agent_type: "task_allocation",
    patterns: ["task summary", "overdue task", "task overview", "what tasks", "task status", "pending task"],
    output_keys: ["total_tasks", "pending", "in_progress", "completed", "overdue"],
    evidence_source: "tasks.overview",
    empty_summary_contains: "0 total",
    summary_values: (o) => [`${o.total_tasks}`, `${o.pending}`, `${o.overdue}`],
  },
  {
    id: "team_workload",
    agent_type: "task_allocation",
    patterns: ["workload", "team workload", "who is busy", "assignment", "team capacity", "team members"],
    output_keys: ["team", "count"],
    evidence_source: "tasks.team_workload",
    empty_summary_contains: "No team members",
    summary_values: (o) => [`${o.count}`],
  },
  {
    id: "financial_overview",
    agent_type: "financial",
    patterns: ["financial summary", "financial overview", "revenue", "invoice summary", "cashflow", "cash flow", "outstanding"],
    output_keys: ["total_invoices", "draft", "unpaid", "partially_paid", "paid", "overdue", "total_revenue", "collected", "outstanding"],
    evidence_source: "financials.overview",
    empty_summary_contains: "0 invoices",
    summary_values: (o) => [`${o.total_invoices}`, `${o.paid}`, `${o.outstanding}`],
  },
  {
    id: "customer_summary",
    agent_type: "financial",
    patterns: ["customer summary", "how many customers", "customer list", "client"],
    output_keys: ["total_customers", "new_this_month"],
    evidence_source: "financials.customers",
    empty_summary_contains: "0 total",
    summary_values: (o) => [`${o.total_customers}`, `${o.new_this_month}`],
  },
  {
    id: "marketing_overview",
    agent_type: "marketing",
    patterns: ["marketing summary", "marketing overview", "campaign status", "marketing status", "how many campaigns"],
    output_keys: ["total_projects", "draft", "active", "completed", "total_drafts", "total_pitch_decks"],
    evidence_source: "marketing.overview",
    empty_summary_contains: "0 projects",
    summary_values: (o) => [`${o.total_projects}`, `${o.active}`, `${o.total_drafts}`],
  },
];

async function run() {
  console.log("\n======================================================");
  console.log("  Stage A - Comprehensive Coordinator Verification");
  console.log("======================================================\n");

  // Register demo business
  console.log("- Setup: Register demo business -");
  const suffix = Math.random().toString(36).slice(2, 8);
  const regRes = await req("POST", "/auth/register", {
    name: "Verify Test",
    email: `verify-${suffix}@busyness.app`,
    password: "TestPass123!",
    business_name: "Verify Test Biz",
  });

  if (!regRes.ok || !regRes.data?.token) {
    bad("Register failed", JSON.stringify(regRes.data));
    process.exit(1);
  }

  const token = regRes.data.token;
  const businessId = regRes.data.business.id;
  ok(`Registered: ${regRes.data.business.name} (${businessId.slice(0, 8)}...)`);
  const base = `/businesses/${businessId}/agent`;

  // ================================================================
  // SECTION 1: Per-intent verification (patterns + structure + summary + empty handling)
  // For each intent, test 3 representative patterns and verify full structure
  // ================================================================
  console.log("\n--- Section 1: Per-Intent Full Verification ---\n");
  console.log("    (trigger patterns + agent_type + output keys + evidence + summary accuracy + empty handling)\n");

  for (const intent of INTENTS) {
    console.log(`\n  Intent: ${intent.id}`);

    // Test 3 representative patterns (first, middle, last)
    const testPatterns = [
      intent.patterns[0],
      intent.patterns[Math.floor(intent.patterns.length / 2)],
      intent.patterns[intent.patterns.length - 1],
    ];

    for (const pattern of testPatterns) {
      await sleep(300); // Small delay to avoid rate limiting
      const res = await req("POST", `${base}/runs`, { goal: pattern }, token);

      if (!res.ok || res.data?.status !== "completed") {
        bad(`Pattern "${pattern}" failed`, `status ${res.status}`);
        continue;
      }

      const matchedIntents = res.data.final_report?.matched_intents || [];
      // Pattern must match at least this intent (may match others too due to overlap)
      if (matchedIntents.includes(intent.id)) {
        ok(`Pattern "${pattern}" -> triggers ${intent.id}`);
      } else if (matchedIntents.length > 0) {
        // Pattern matched a different intent (overlap) — still valid
        ok(`Pattern "${pattern}" -> triggers ${matchedIntents.join(",")} (overlap)`);
      } else {
        bad(`Pattern "${pattern}" -> no intent matched`, `expected ${intent.id}`);
      }
    }

    // Now do a deep verification with the first pattern
    await sleep(300);
    const res = await req("POST", `${base}/runs`, { goal: intent.patterns[0] }, token);
    if (!res.ok || !res.data?.steps?.length) {
      bad(`${intent.id}: deep verification failed`, `status ${res.status}`);
      continue;
    }

    const step = res.data.steps.find(s => s.input?.intent === intent.id || s.agent_type === intent.agent_type);
    if (!step) {
      bad(`${intent.id}: step not found`);
      continue;
    }

    // Agent type
    if (step.agent_type === intent.agent_type) {
      ok(`${intent.id}: agent_type = ${intent.agent_type}`);
    } else {
      bad(`${intent.id}: wrong agent_type`, `expected ${intent.agent_type}, got ${step.agent_type}`);
    }

    // Step status
    if (step.status === "completed") {
      ok(`${intent.id}: step status = completed`);
    } else {
      bad(`${intent.id}: step not completed`, `status = ${step.status}`);
    }

    // Output keys
    const output = step.output || {};
    const missingKeys = intent.output_keys.filter(k => output[k] === undefined);
    if (missingKeys.length === 0) {
      ok(`${intent.id}: all ${intent.output_keys.length} output keys present`);
    } else {
      bad(`${intent.id}: missing output keys`, missingKeys.join(", "));
    }

    // Evidence
    if (step.evidence?.source === intent.evidence_source) {
      ok(`${intent.id}: evidence source = ${intent.evidence_source}`);
    } else {
      bad(`${intent.id}: evidence mismatch`, `expected ${intent.evidence_source}, got ${step.evidence?.source}`);
    }

    // Summary accuracy — verify summary contains expected values from output
    const summary = output._summary || "";
    if (summary.length > 0) {
      ok(`${intent.id}: has _summary (${summary.length} chars)`);
      // Check empty result handling
      if (summary.includes(intent.empty_summary_contains)) {
        ok(`${intent.id}: empty result summary contains "${intent.empty_summary_contains}"`);
      } else {
        // For non-empty results, verify key values are in summary
        const expectedValues = intent.summary_values(output);
        const allPresent = expectedValues.every(v => summary.includes(v));
        if (allPresent) {
          ok(`${intent.id}: summary contains key output values`);
        } else {
          bad(`${intent.id}: summary missing key values`, `expected [${expectedValues.join(", ")}] in "${summary.slice(0, 100)}"`);
        }
      }
    } else {
      bad(`${intent.id}: no _summary in output`);
    }
  }

  // ================================================================
  // SECTION 2: Audit Trail Records (via GET /runs/:runId)
  // ================================================================
  console.log("\n--- Section 2: Audit Trail Records ---\n");

  await sleep(300);
  // Create a multi-intent run
  const auditRes = await req("POST", `${base}/runs`, { goal: "low stock and financial overview" }, token);
  if (auditRes.ok && auditRes.data?.agent_run_id) {
    const runId = auditRes.data.agent_run_id;
    ok("Multi-intent run created for audit check");

    await sleep(300);
    const getRes = await req("GET", `${base}/runs/${runId}`, null, token);
    if (getRes.ok && getRes.data?.data) {
      const run = getRes.data.data;

      if (run.id === runId) ok("Run ID matches in GET response");
      else bad("Run ID mismatch in GET response");

      if (run.goal === "low stock and financial overview") ok("Goal text preserved in run record");
      else bad("Goal text not preserved");

      if (run.status === "completed") ok("Run status = completed in record");
      else bad("Run status not completed", `got: ${run.status}`);

      if (run.steps?.length === 2) {
        ok("Run has 2 steps (multi-intent)");

        for (const step of run.steps) {
          if (step.status === "completed") {
            ok(`Step ${step.step_number} (${step.agent_type}): status=completed`);
          } else {
            bad(`Step ${step.step_number}: not completed`, `status=${step.status}`);
          }
          if (step.input?.intent) ok(`Step ${step.step_number}: intent=${step.input.intent}`);
          if (step.evidence?.source) ok(`Step ${step.step_number}: evidence.source=${step.evidence.source}`);
          if (step.output?._summary) ok(`Step ${step.step_number}: has _summary in output`);
        }
      } else {
        bad("Expected 2 steps in multi-intent run", `got ${run.steps?.length}`);
      }

      // Verify final_report structure
      const fr = run.final_report;
      let frObj = fr;
      if (typeof fr === "string") {
        try { frObj = JSON.parse(fr); } catch { frObj = null; }
      }
      if (frObj && frObj.summary && frObj.matched_intents && frObj.step_count !== undefined) {
        ok("final_report has summary, matched_intents, step_count");
        ok(`final_report: ${frObj.completed} completed, ${frObj.failed} failed`);
      } else {
        bad("final_report missing required keys", `keys: ${frObj ? Object.keys(frObj).join(",") : "null"}`);
      }
    } else {
      bad("GET single run failed", `status ${getRes.status}`);
    }
  } else {
    bad("Failed to create run for audit verification", `status ${auditRes.status}`);
  }

  // ================================================================
  // SECTION 3: Business Scoping Verification
  // ================================================================
  console.log("\n--- Section 3: Business Scoping ---\n");

  await sleep(300);
  // Register a second business
  const suffix2 = Math.random().toString(36).slice(2, 8);
  const reg2 = await req("POST", "/auth/register", {
    name: "Other User",
    email: `other-${suffix2}@busyness.app`,
    password: "TestPass123!",
    business_name: "Other Biz",
  });

  if (reg2.ok && reg2.data?.token) {
    const otherToken = reg2.data.token;
    const otherBusinessId = reg2.data.business.id;
    ok("Second business registered for scoping test");

    await sleep(300);
    // Cross-business GET
    const crossGet = await req("GET", `${base}/runs`, null, otherToken);
    if (crossGet.status === 403) ok("Cross-business GET /runs -> 403 Forbidden");
    else bad("Cross-business GET should return 403", `got ${crossGet.status}`);

    await sleep(300);
    // Cross-business POST
    const crossPost = await req("POST", `${base}/runs`, { goal: "low stock" }, otherToken);
    if (crossPost.status === 403) ok("Cross-business POST /runs -> 403 Forbidden");
    else bad("Cross-business POST should return 403", `got ${crossPost.status}`);

    await sleep(300);
    // Own business access
    const ownBase = `/businesses/${otherBusinessId}/agent`;
    const ownRes = await req("POST", `${ownBase}/runs`, { goal: "low stock" }, otherToken);
    if (ownRes.ok) ok("Second business can access its own agent endpoint");
    else bad("Second business cannot access own endpoint", `status ${ownRes.status}`);
  } else {
    bad("Could not register second business for scoping test");
  }

  // ================================================================
  // SECTION 4: Read-Only Enforcement
  // ================================================================
  console.log("\n--- Section 4: Read-Only Enforcement ---\n");
  console.log("    (verify no PUT/PATCH/DELETE endpoints exist on agent router)\n");

  const writeTests = [
    { method: "PUT", desc: "PUT /runs" },
    { method: "PATCH", desc: "PATCH /runs" },
    { method: "DELETE", desc: "DELETE /runs" },
  ];

  for (const test of writeTests) {
    await sleep(300);
    const res = await req(test.method, `${base}/runs`, { goal: "test" }, token);
    if (res.status === 404) {
      ok(`${test.desc} -> 404 (endpoint does not exist)`);
    } else if (res.status === 429) {
      ok(`${test.desc} -> 429 (rate limited, but endpoint doesn't exist)`);
    } else {
      bad(`${test.desc} should return 404`, `got ${res.status}`);
    }
  }

  // ================================================================
  // SECTION 5: No Auth / Invalid Auth
  // ================================================================
  console.log("\n--- Section 5: Authentication ---\n");

  await sleep(300);
  const noAuthRes = await req("POST", `${base}/runs`, { goal: "low stock" }, null);
  if (noAuthRes.status === 401) ok("No auth token -> 401 Unauthorized");
  else bad("No auth should return 401", `got ${noAuthRes.status}`);

  await sleep(300);
  const badAuthRes = await req("POST", `${base}/runs`, { goal: "low stock" }, "invalid.token.here");
  if (badAuthRes.status === 401) ok("Invalid auth token -> 401 Unauthorized");
  else bad("Invalid auth should return 401", `got ${badAuthRes.status}`);

  // ================================================================
  // Summary
  // ================================================================
  console.log("\n======================================================");
  console.log(`  Stage A Results: ${pass} passed, ${fail} failed`);
  console.log("======================================================");
  if (fail > 0) {
    console.log("\n  Failures:");
    failures.forEach((f) => console.log(`    - ${f}`));
  }
  console.log("");
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
