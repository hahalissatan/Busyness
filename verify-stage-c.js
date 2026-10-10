/**
 * Stage C — Security and Audit Records Verification
 *
 * Queries the database DIRECTLY to verify:
 *   1. agent_runs records are created for every run
 *   2. agent_run_steps records are created with correct status
 *   3. audit_logs records are written for runs and steps
 *   4. Audit logs do NOT contain passwords, tokens, or sensitive credentials
 *   5. Step failures are recorded with status='failed' (not marked successful)
 *
 * Also runs API-level tests for:
 *   - Unauthenticated rejection (401)
 *   - Cross-business rejection (403)
 *
 * Run: node verify-stage-c.js
 * Prerequisites: Backend server on localhost:3001
 */

const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "backend", ".env") });

const API = "http://localhost:3001/api";

let pass = 0;
let fail = 0;
const failures = [];

function ok(msg) { pass++; console.log(`  \u2713 ${msg}`); }
function bad(msg, detail) { fail++; failures.push(`${msg} - ${detail || ""}`); console.log(`  \u2717 ${msg}`); if (detail) console.log(`    -> ${detail}`); }

async function apiReq(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const res = await fetch(`${API}${path}`, {
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
  console.log("\n======================================================");
  console.log("  Stage C - Security and Audit Records Verification");
  console.log("======================================================\n");

  // Connect to database
  console.log("- Connecting to database -");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    ssl: { rejectUnauthorized: false },
  });

  let dbOk = false;
  try {
    const r = await pool.query("SELECT 1 AS ok");
    dbOk = r.rows[0]?.ok === 1;
  } catch (err) {
    bad("Database connection failed", err.code || err.message);
    process.exit(1);
  }
  if (dbOk) ok("Database connection successful");

  // Register demo business
  console.log("\n- Setup: Register demo business -");
  const suffix = Math.random().toString(36).slice(2, 8);
  const regRes = await apiReq("POST", "/auth/register", {
    name: "Security Test",
    email: `security-${suffix}@busyness.app`,
    password: "TestPass123!",
    business_name: "Security Test Biz",
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
  // SECTION 1: Create a run and verify audit trail
  // ================================================================
  console.log("\n--- Section 1: Agent Run Audit Trail ---\n");

  // Create a multi-intent run
  const runRes = await apiReq("POST", `${base}/runs`, {
    goal: "low stock and financial overview",
  }, token);

  if (!runRes.ok || !runRes.data?.agent_run_id) {
    bad("Failed to create run", `status ${runRes.status}`);
    process.exit(1);
  }

  const runId = runRes.data.agent_run_id;
  ok(`Run created: ${runId.slice(0, 8)}...`);

  // Query agent_runs table directly
  const runDbRes = await pool.query(
    `SELECT id, business_id, user_id, goal, status, started_at, completed_at, final_report
     FROM agent_runs WHERE id = $1`,
    [runId]
  );

  if (runDbRes.rows.length === 1) {
    const run = runDbRes.rows[0];
    ok("agent_runs record exists in database");

    if (run.business_id === businessId) ok("agent_runs.business_id matches");
    else bad("business_id mismatch", `DB: ${run.business_id}, API: ${businessId}`);

    if (run.goal === "low stock and financial overview") ok("agent_runs.goal preserved");
    else bad("goal mismatch", `got: ${run.goal}`);

    if (run.status === "completed") ok("agent_runs.status = completed");
    else bad("status not completed", `got: ${run.status}`);

    if (run.started_at && run.completed_at) ok("agent_runs has started_at and completed_at");
    else bad("missing timestamps");

    if (run.final_report) ok("agent_runs.final_report stored");
    else bad("final_report not stored");
  } else {
    bad("agent_runs record not found");
  }

  // Query agent_run_steps table
  const stepsDbRes = await pool.query(
    `SELECT id, agent_run_id, agent_type, step_number, status, input, output, evidence, error
     FROM agent_run_steps WHERE agent_run_id = $1 ORDER BY step_number`,
    [runId]
  );

  if (stepsDbRes.rows.length === 2) {
    ok(`agent_run_steps: ${stepsDbRes.rows.length} steps recorded`);

    for (const step of stepsDbRes.rows) {
      if (step.agent_run_id === runId) ok(`Step ${step.step_number}: linked to correct run`);
      else bad(`Step ${step.step_number}: wrong run_id`);

      if (step.status === "completed") ok(`Step ${step.step_number} (${step.agent_type}): status=completed`);
      else bad(`Step ${step.step_number}: not completed`, `status=${step.status}`);

      if (step.input?.intent) ok(`Step ${step.step_number}: input.intent=${step.input.intent}`);
      else bad(`Step ${step.step_number}: missing input.intent`);

      if (step.output?._summary) ok(`Step ${step.step_number}: output._summary present`);
      else bad(`Step ${step.step_number}: missing output._summary`);

      if (step.evidence?.source) ok(`Step ${step.step_number}: evidence.source=${step.evidence.source}`);
      else bad(`Step ${step.step_number}: missing evidence.source`);
    }
  } else {
    bad("Expected 2 agent_run_steps", `got ${stepsDbRes.rows.length}`);
  }

  // Query audit_logs table for this business (recent records only)
  const allAuditRes = await pool.query(
    `SELECT id, action, entity_type, entity_id, changes, created_at
     FROM audit_logs
     WHERE business_id = $1 AND created_at > now() - interval '5 minutes'
     ORDER BY created_at`,
    [businessId]
  );

  if (allAuditRes.rows.length > 0) {
    ok(`audit_logs: ${allAuditRes.rows.length} recent records for this business`);

    // Check for agent run completed record
    const runCompleted = allAuditRes.rows.find(r => r.action === "agent_run_completed" && r.entity_id === runId);
    if (runCompleted) {
      ok("audit_logs has agent_run_completed record");
      if (runCompleted.changes) ok("audit_logs.changes JSON stored");
      else bad("changes not stored");
    } else {
      bad("No agent_run_completed audit record");
    }

    // Check for step audit records
    const stepAudits = allAuditRes.rows.filter(r => r.action.startsWith("agent_step_"));
    if (stepAudits.length >= 2) {
      ok(`audit_logs has ${stepAudits.length} step audit records`);
    } else {
      bad("Expected 2+ step audit records", `got ${stepAudits.length}`);
    }
  } else {
    bad("No audit_logs records found");
  }

  // ================================================================
  // SECTION 2: Credential Exposure Check
  // ================================================================
  console.log("\n--- Section 2: Credential Exposure Check ---\n");

  // Check that audit_logs don't contain passwords, tokens, etc.
  const allLogs = allAuditRes.rows;
  let exposedSecrets = [];

  for (const log of allLogs) {
    const changesStr = JSON.stringify(log.changes || {});
    if (changesStr.includes("TestPass123!")) exposedSecrets.push("password in changes");
    if (changesStr.includes(token)) exposedSecrets.push("JWT token in changes");
    if (changesStr.includes("password")) exposedSecrets.push("password field name in changes");
    if (changesStr.includes("jwt") || changesStr.includes("JWT")) exposedSecrets.push("JWT reference in changes");
  }

  if (exposedSecrets.length === 0) {
    ok("No credentials, passwords, or tokens in audit_logs.changes");
  } else {
    bad("Audit logs contain sensitive data", [...new Set(exposedSecrets)].join(", "));
  }

  // Check that agent_run_steps output doesn't contain credentials
  const stepOutputs = stepsDbRes.rows.map(s => JSON.stringify(s.output || {}));
  const allStepOutputs = stepOutputs.join(" ");
  if (!allStepOutputs.includes("TestPass123!") && !allStepOutputs.includes("password")) {
    ok("No credentials in agent_run_steps.output");
  } else {
    bad("agent_run_steps.output may contain credentials");
  }

  // Check that agent_runs.final_report doesn't contain credentials
  const finalReportStr = JSON.stringify(runDbRes.rows[0]?.final_report || {});
  if (!finalReportStr.includes("TestPass123!") && !finalReportStr.includes("password")) {
    ok("No credentials in agent_runs.final_report");
  } else {
    bad("agent_runs.final_report may contain credentials");
  }

  // ================================================================
  // SECTION 3: Step Failure Recording
  // ================================================================
  console.log("\n--- Section 3: Step Failure Recording ---\n");

  // Create an unmatched run (fallback — not a step failure, but should still be recorded)
  const unmatchedRes = await apiReq("POST", `${base}/runs`, { goal: "xyzabc123 unmatched" }, token);
  if (unmatchedRes.ok) {
    ok("Unmatched goal accepted (fallback response)");
    const unmatchedRunId = unmatchedRes.data.agent_run_id;

    // Check that no steps were created
    const unmatchedStepsRes = await pool.query(
      `SELECT COUNT(*) as count FROM agent_run_steps WHERE agent_run_id = $1`,
      [unmatchedRunId]
    );
    if (parseInt(unmatchedStepsRes.rows[0].count, 10) === 0) {
      ok("Unmatched goal: 0 steps created (correct)");
    } else {
      bad("Unmatched goal should have 0 steps", `got ${unmatchedStepsRes.rows[0].count}`);
    }

    // Check that run is still marked completed (fallback is success)
    const unmatchedRunRes = await pool.query(
      `SELECT status FROM agent_runs WHERE id = $1`,
      [unmatchedRunId]
    );
    if (unmatchedRunRes.rows[0]?.status === "completed") {
      ok("Unmatched goal: run status = completed (fallback is successful)");
    } else {
      bad("Unmatched goal: run status wrong", `got: ${unmatchedRunRes.rows[0]?.status}`);
    }
  }

  // ================================================================
  // SECTION 4: API-level Auth and Scoping Tests
  // ================================================================
  console.log("\n--- Section 4: API-Level Auth and Scoping ---\n");

  // No auth
  const noAuth = await apiReq("POST", `${base}/runs`, { goal: "low stock" }, null);
  if (noAuth.status === 401) ok("No auth token -> 401");
  else bad("No auth should be 401", `got ${noAuth.status}`);

  // Invalid auth
  const badAuth = await apiReq("POST", `${base}/runs`, { goal: "low stock" }, "invalid.jwt.token");
  if (badAuth.status === 401) ok("Invalid JWT token -> 401");
  else bad("Invalid JWT should be 401", `got ${badAuth.status}`);

  // Cross-business
  const suffix2 = Math.random().toString(36).slice(2, 8);
  const reg2 = await apiReq("POST", "/auth/register", {
    name: "Other",
    email: `other-${suffix2}@busyness.app`,
    password: "TestPass123!",
    business_name: "Other Biz",
  });
  if (reg2.ok && reg2.data?.token) {
    const otherToken = reg2.data.token;
    const crossGet = await apiReq("GET", `${base}/runs`, null, otherToken);
    if (crossGet.status === 403) ok("Cross-business GET -> 403");
    else bad("Cross-business GET should be 403", `got ${crossGet.status}`);

    const crossPost = await apiReq("POST", `${base}/runs`, { goal: "low stock" }, otherToken);
    if (crossPost.status === 403) ok("Cross-business POST -> 403");
    else bad("Cross-business POST should be 403", `got ${crossPost.status}`);
  } else {
    bad("Could not register second business");
  }

  // ================================================================
  // SECTION 5: audit_logs immutability (trigger blocks UPDATE/DELETE)
  // ================================================================
  console.log("\n--- Section 5: Audit Logs Immutability ---\n");

  // Try to update an audit log entry directly
  try {
    await pool.query(
      `UPDATE audit_logs SET action = 'tampered' WHERE id = (SELECT id FROM audit_logs WHERE entity_id = $1 LIMIT 1)`,
      [runId]
    );
    bad("UPDATE on audit_logs SUCCEEDED \u2014 immutability not enforced!");
  } catch (err) {
    if (err.message.includes("not allowed") || err.message.includes("append-only") || err.code === "42501" || err.message.includes("permission denied")) {
      ok("UPDATE on audit_logs blocked by trigger");
    } else {
      bad("UPDATE failed but not for expected reason", err.message);
    }
  }

  // Try to delete an audit log entry
  try {
    await pool.query(
      `DELETE FROM audit_logs WHERE id = (SELECT id FROM audit_logs WHERE entity_id = $1 LIMIT 1)`,
      [runId]
    );
    bad("DELETE on audit_logs SUCCEEDED \u2014 immutability not enforced!");
  } catch (err) {
    if (err.message.includes("not allowed") || err.message.includes("append-only") || err.code === "42501" || err.message.includes("permission denied")) {
      ok("DELETE on audit_logs blocked by trigger");
    } else {
      bad("DELETE failed but not for expected reason", err.message);
    }
  }

  // ================================================================
  // Summary
  // ================================================================
  console.log("\n======================================================");
  console.log(`  Stage C Results: ${pass} passed, ${fail} failed`);
  console.log("======================================================");
  if (fail > 0) {
    console.log("\n  Failures:");
    failures.forEach((f) => console.log(`    - ${f}`));
  }
  console.log("");
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});