/**
 * Smoke test for Coordinator Agent — Stage D
 * Tests the minimal end-to-end coordinator path.
 *
 * Run: node smoke-test-coordinator.js
 *
 * Prerequisites: Backend server running on localhost:3001
 */

const BASE = "http://localhost:3001/api";

let pass = 0;
let fail = 0;
const failures = [];

function ok(msg) { pass++; console.log(`  ✓ ${msg}`); }
function bad(msg, detail) { fail++; failures.push(`${msg} — ${detail || ""}`); console.log(`  ✗ ${msg}`); if (detail) console.log(`    → ${detail}`); }

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

async function run() {
  console.log("\n═══════════════════════════════════════");
  console.log("  Coordinator Agent — Smoke Test (Stage D)");
  console.log("═══════════════════════════════════════\n");

  // ── Register demo business ──
  console.log("─ Setup: Register demo business ─");
  const suffix = Math.random().toString(36).slice(2, 8);
  const regRes = await req("POST", "/auth/register", {
    name: "Coordinator Test",
    email: `coord-test-${suffix}@busyness.app`,
    password: "TestPass123!",
    business_name: "Coordinator Test Biz",
  });

  if (!regRes.ok || !regRes.data?.token) {
    bad("Register failed", JSON.stringify(regRes.data));
    console.log("\n  Aborting — cannot continue without auth.\n");
    process.exit(1);
  }

  const token = regRes.data.token;
  const businessId = regRes.data.business.id;
  ok(`Registered: ${regRes.data.business.name} (${businessId.slice(0, 8)}…)`);
  const base = `/businesses/${businessId}/agent`;

  // ═══════════════════════════════════════
  // 1. POST /agent/runs — Empty goal (validation error)
  // ═══════════════════════════════════════
  console.log("\n─ Test 1: Empty goal → 400 ─");
  {
    const res = await req("POST", `${base}/runs`, { goal: "" }, token);
    if (res.status === 400) ok("Empty goal returns 400");
    else bad("Empty goal should return 400", `got ${res.status}`);
  }

  // ═══════════════════════════════════════
  // 2. POST /agent/runs — Missing goal field
  // ═══════════════════════════════════════
  console.log("\n─ Test 2: Missing goal field → 400 ─");
  {
    const res = await req("POST", `${base}/runs`, {}, token);
    if (res.status === 400) ok("Missing goal returns 400");
    else bad("Missing goal should return 400", `got ${res.status}`);
  }

  // ═══════════════════════════════════════
  // 3. POST /agent/runs — Unmatched goal (fallback)
  // ═══════════════════════════════════════
  console.log("\n─ Test 3: Unmatched goal → fallback response ─");
  let fallbackRunId;
  {
    const res = await req("POST", `${base}/runs`, { goal: "tell me a joke" }, token);
    if (res.ok && res.data?.status === "completed") {
      ok("Unmatched goal returns 200 with status 'completed'");
      if (res.data.steps?.length === 0) {
        ok("No steps created (no intent matched)");
      } else {
        bad("Should have 0 steps for unmatched goal", `got ${res.data.steps?.length}`);
      }
      if (res.data.final_report?.summary?.includes("I can help with")) {
        ok("Fallback summary lists available capabilities");
      } else {
        bad("Fallback summary should mention capabilities");
      }
      if (res.data.final_report?.capabilities?.length >= 5) {
        ok(`Capabilities listed: ${res.data.final_report.capabilities.length} intents`);
      } else {
        bad("Should list capabilities in final_report");
      }
      fallbackRunId = res.data.agent_run_id;
    } else {
      bad("Unmatched goal should return 200", `got ${res.status}: ${JSON.stringify(res.data)}`);
    }
  }

  // ═══════════════════════════════════════
  // 4. POST /agent/runs — Single intent: low_stock
  // ═══════════════════════════════════════
  console.log("\n─ Test 4: Single intent (low stock) ─");
  let lowStockRunId;
  {
    const res = await req("POST", `${base}/runs`, { goal: "show me low stock items" }, token);
    if (res.ok && res.data?.status === "completed") {
      ok("Low stock query returns 200 completed");
      if (res.data.steps?.length === 1) {
        ok(`1 step created (agent_type: ${res.data.steps[0].agent_type})`);
        if (res.data.steps[0].agent_type === "inventory") {
          ok("Step agent_type is 'inventory'");
        } else {
          bad("Step agent_type should be 'inventory'", res.data.steps[0].agent_type);
        }
        if (res.data.steps[0].status === "completed") {
          ok("Step status is 'completed'");
        }
        if (res.data.steps[0].output?.count !== undefined) {
          ok(`Output has count: ${res.data.steps[0].output.count}`);
        }
        if (res.data.steps[0].evidence?.source) {
          ok(`Evidence source: ${res.data.steps[0].evidence.source}`);
        }
      } else {
        bad("Should have 1 step", `got ${res.data.steps?.length}`);
      }
      if (res.data.final_report?.summary) {
        ok("Final report has summary");
      }
      if (res.data.final_report?.matched_intents?.includes("low_stock")) {
        ok("matched_intents includes 'low_stock'");
      }
      lowStockRunId = res.data.agent_run_id;
    } else {
      bad("Low stock query failed", `got ${res.status}: ${JSON.stringify(res.data)?.slice(0, 200)}`);
    }
  }

  // ═══════════════════════════════════════
  // 5. POST /agent/runs — Single intent: financial_overview
  // ═══════════════════════════════════════
  console.log("\n─ Test 5: Single intent (financial overview) ─");
  {
    const res = await req("POST", `${base}/runs`, { goal: "give me a financial summary" }, token);
    if (res.ok && res.data?.status === "completed") {
      ok("Financial overview returns 200 completed");
      if (res.data.steps?.length === 1 && res.data.steps[0].agent_type === "financial") {
        ok("Step agent_type is 'financial'");
        if (res.data.steps[0].output?.total_invoices !== undefined) {
          ok(`Output has total_invoices: ${res.data.steps[0].output.total_invoices}`);
        }
        if (res.data.steps[0].output?.total_revenue !== undefined) {
          ok(`Output has total_revenue: ${res.data.steps[0].output.total_revenue}`);
        }
      } else {
        bad("Should have 1 financial step", `got ${res.data.steps?.length} steps`);
      }
    } else {
      bad("Financial overview failed", `got ${res.status}`);
    }
  }

  // ═══════════════════════════════════════
  // 6. POST /agent/runs — Single intent: task_overview
  // ═══════════════════════════════════════
  console.log("\n─ Test 6: Single intent (task overview) ─");
  {
    const res = await req("POST", `${base}/runs`, { goal: "show me the task overview" }, token);
    if (res.ok && res.data?.status === "completed") {
      ok("Task overview returns 200 completed");
      if (res.data.steps?.length === 1 && res.data.steps[0].agent_type === "task_allocation") {
        ok("Step agent_type is 'task_allocation'");
        if (res.data.steps[0].output?.total_tasks !== undefined) {
          ok(`Output has total_tasks: ${res.data.steps[0].output.total_tasks}`);
        }
        if (res.data.steps[0].output?.overdue !== undefined) {
          ok(`Output has overdue: ${res.data.steps[0].output.overdue}`);
        }
      } else {
        bad("Should have 1 task_allocation step");
      }
    } else {
      bad("Task overview failed", `got ${res.status}`);
    }
  }

  // ═══════════════════════════════════════
  // 7. POST /agent/runs — Single intent: marketing_overview
  // ═══════════════════════════════════════
  console.log("\n─ Test 7: Single intent (marketing overview) ─");
  {
    const res = await req("POST", `${base}/runs`, { goal: "marketing overview please" }, token);
    if (res.ok && res.data?.status === "completed") {
      ok("Marketing overview returns 200 completed");
      if (res.data.steps?.length === 1 && res.data.steps[0].agent_type === "marketing") {
        ok("Step agent_type is 'marketing'");
        if (res.data.steps[0].output?.total_projects !== undefined) {
          ok(`Output has total_projects: ${res.data.steps[0].output.total_projects}`);
        }
      } else {
        bad("Should have 1 marketing step");
      }
    } else {
      bad("Marketing overview failed", `got ${res.status}`);
    }
  }

  // ═══════════════════════════════════════
  // 8. POST /agent/runs — Multi-intent: "low stock and overdue tasks"
  // ═══════════════════════════════════════
  console.log("\n─ Test 8: Multi-intent (low stock + tasks) ─");
  {
    const res = await req("POST", `${base}/runs`, {
      goal: "show me low stock and overdue tasks"
    }, token);
    if (res.ok && res.data?.status === "completed") {
      ok("Multi-intent query returns 200 completed");
      if (res.data.steps?.length === 2) {
        ok(`2 steps created`);
        const types = res.data.steps.map(s => s.agent_type).sort();
        if (types.join(",") === "inventory,task_allocation") {
          ok("Step agent_types are inventory + task_allocation");
        } else {
          bad("Wrong agent types", types.join(","));
        }
        if (res.data.final_report?.matched_intents?.length === 2) {
          ok("matched_intents has 2 entries");
        }
        if (res.data.final_report?.summary?.includes("\n")) {
          ok("Final report combines both step summaries");
        }
      } else {
        bad("Should have 2 steps", `got ${res.data.steps?.length}`);
      }
    } else {
      bad("Multi-intent query failed", `got ${res.status}`);
    }
  }

  // ═══════════════════════════════════════
  // 9. POST /agent/runs — Inventory summary
  // ═══════════════════════════════════════
  console.log("\n─ Test 9: Inventory summary ─");
  {
    const res = await req("POST", `${base}/runs`, {
      goal: "inventory summary"
    }, token);
    if (res.ok && res.data?.steps?.length === 1) {
      ok("Inventory summary returns 1 step");
      if (res.data.steps[0].output?.total_products !== undefined) {
        ok(`total_products: ${res.data.steps[0].output.total_products}`);
      }
    } else {
      bad("Inventory summary failed");
    }
  }

  // ═══════════════════════════════════════
  // 10. POST /agent/runs — Team workload
  // ═══════════════════════════════════════
  console.log("\n─ Test 10: Team workload ─");
  {
    const res = await req("POST", `${base}/runs`, {
      goal: "show team workload"
    }, token);
    if (res.ok && res.data?.steps?.length === 1) {
      ok("Team workload returns 1 step");
      if (res.data.steps[0].agent_type === "task_allocation") {
        ok("Step agent_type is 'task_allocation'");
      }
      if (res.data.steps[0].output?.team !== undefined) {
        ok(`Output has team array (${res.data.steps[0].output.count} members)`);
      }
    } else {
      bad("Team workload failed");
    }
  }

  // ═══════════════════════════════════════
  // 11. POST /agent/runs — Customer summary
  // ═══════════════════════════════════════
  console.log("\n─ Test 11: Customer summary ─");
  {
    const res = await req("POST", `${base}/runs`, {
      goal: "how many customers do I have"
    }, token);
    if (res.ok && res.data?.steps?.length === 1) {
      ok("Customer summary returns 1 step");
      if (res.data.steps[0].output?.total_customers !== undefined) {
        ok(`total_customers: ${res.data.steps[0].output.total_customers}`);
      }
    } else {
      bad("Customer summary failed");
    }
  }

  // ═══════════════════════════════════════
  // 12. GET /agent/runs — List recent runs
  // ═══════════════════════════════════════
  console.log("\n─ Test 12: List recent agent runs ─");
  {
    const res = await req("GET", `${base}/runs?limit=10`, null, token);
    if (res.ok && res.data?.data) {
      ok(`List returns ${res.data.data.length} runs`);
      if (res.data.data.length >= 5) {
        ok("At least 5 runs in history");
      }
      if (res.data.data[0]?.id) {
        ok("First run has id");
      }
      if (res.data.data[0]?.goal) {
        ok("First run has goal text");
      }
      if (res.data.data[0]?.status) {
        ok(`First run status: ${res.data.data[0].status}`);
      }
    } else {
      bad("List runs failed", `got ${res.status}`);
    }
  }

  // ═══════════════════════════════════════
  // 13. GET /agent/runs/:runId — Get single run with steps
  // ═══════════════════════════════════════
  console.log("\n─ Test 13: Get single agent run with steps ─");
  if (lowStockRunId) {
    const res = await req("GET", `${base}/runs/${lowStockRunId}`, null, token);
    if (res.ok && res.data?.data) {
      ok("Get single run returns 200");
      if (res.data.data.id === lowStockRunId) {
        ok("Run ID matches");
      }
      if (res.data.data.goal) {
        ok("Run has goal text");
      }
      if (res.data.data.steps?.length >= 1) {
        ok(`Run has ${res.data.data.steps.length} step(s)`);
        if (res.data.data.steps[0].agent_type) {
          ok(`Step 1 agent_type: ${res.data.data.steps[0].agent_type}`);
        }
        if (res.data.data.steps[0].input?.intent) {
          ok(`Step 1 intent: ${res.data.data.steps[0].input.intent}`);
        }
      }
    } else {
      bad("Get single run failed", `got ${res.status}`);
    }
  } else {
    bad("Cannot test get single run — no run ID from test 4");
  }

  // ═══════════════════════════════════════
  // 14. GET /agent/runs/:runId — Non-existent run
  // ═══════════════════════════════════════
  console.log("\n─ Test 14: Get non-existent run → 404 ─");
  {
    const fakeId = "00000000-0000-4000-8000-000000000000";
    const res = await req("GET", `${base}/runs/${fakeId}`, null, token);
    if (res.status === 404) {
      ok("Non-existent run returns 404");
    } else {
      bad("Non-existent run should return 404", `got ${res.status}`);
    }
  }

  // ═══════════════════════════════════════
  // 15. POST /agent/runs — No auth token
  // ═══════════════════════════════════════
  console.log("\n─ Test 15: No auth token → 401 ─");
  {
    const res = await req("POST", `${base}/runs`, { goal: "low stock" }, null);
    if (res.status === 401) {
      ok("No token returns 401");
    } else {
      bad("No token should return 401", `got ${res.status}`);
    }
  }

  // ═══════════════════════════════════════
  // 16. GET /agent/runs — Wrong business ID (auth scoping)
  // ═══════════════════════════════════════
  console.log("\n─ Test 16: Cross-business access → 403 ─");
  {
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
      // Try to access the first business's agent runs with the second token
      const res = await req("GET", `${base}/runs`, null, otherToken);
      if (res.status === 403) {
        ok("Cross-business access returns 403 Forbidden");
      } else {
        bad("Cross-business access should return 403", `got ${res.status}`);
      }
    } else {
      bad("Could not register second business for cross-business test");
    }
  }

  // ═══════════════════════════════════════
  // 17. POST /agent/runs — Goal too long
  // ═══════════════════════════════════════
  console.log("\n─ Test 17: Goal too long → 400 ─");
  {
    const longGoal = "a".repeat(1001);
    const res = await req("POST", `${base}/runs`, { goal: longGoal }, token);
    if (res.status === 400) {
      ok("Goal > 1000 chars returns 400");
    } else {
      bad("Long goal should return 400", `got ${res.status}`);
    }
  }

  // ═══════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════
  console.log("\n═══════════════════════════════════════");
  console.log(`  Results: ${pass} passed, ${fail} failed`);
  console.log("═══════════════════════════════════════");
  if (fail > 0) {
    console.log("\n  Failures:");
    failures.forEach((f) => console.log(`    • ${f}`));
  }
  console.log("");
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
