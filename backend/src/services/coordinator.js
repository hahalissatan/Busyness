/**
 * services/coordinator.js — Coordinator Agent service.
 *
 * This is a RULE-BASED coordinator that does NOT call an external LLM.
 * It pattern-matches the user's natural-language goal against known
 * intent patterns, then executes REAL database queries scoped to the
 * authenticated business.
 *
 * Every query uses parameterized placeholders ($1) with business_id
 * from the authenticated request — never from user input.
 *
 * All operations in the minimal path are READ-ONLY.
 *
 * Lifecycle:
 *   1. Create agent_run (status='planning')
 *   2. Match intents from goal text
 *   3. For each matched intent: create step, execute query, record output
 *   4. Aggregate into final_report
 *   5. Update agent_run (status='completed')
 *   6. Write audit_logs for each step
 */

import { randomUUID } from "crypto";
import { query } from "../db/pool.js";
import { INVENTORY_INTENTS, getInventoryIntentIds } from "./inventoryAgent.js";

// --- Intent Registry ----------------------------------------------------

/**
 * Each intent defines:
 *   id          — unique identifier
 *   agent_type  — which specialist domain (inventory, financial, etc.)
 *   label       — human-readable name
 *   patterns    — case-insensitive substrings that trigger this intent
 *   execute     — async function(businessId) → { output, evidence }
 */
const INTENT_REGISTRY = [
  {
    id: "low_stock",
    agent_type: "inventory",
    label: "Low Stock Alert",
    patterns: ["low stock", "low-stock", "stock alert", "reorder", "restock", "running low"],
    async execute(businessId) {
      const res = await query(
        `SELECT id, name, sku, stock_quantity, min_stock_threshold, unit_cost
         FROM products
         WHERE business_id = $1 AND stock_quantity <= min_stock_threshold
         ORDER BY (min_stock_threshold - stock_quantity) DESC NULLS LAST
         LIMIT 20`,
        [businessId]
      );
      return {
        output: {
          items: res.rows,
          count: res.rows.length,
        },
        evidence: {
          query: "SELECT products WHERE stock_quantity <= min_stock_threshold",
          row_count: res.rows.length,
          source: "inventory.products",
        },
      };
    },
  },
  {
    id: "inventory_summary",
    agent_type: "inventory",
    label: "Inventory Summary",
    patterns: ["inventory summary", "stock summary", "how much stock", "inventory status", "product count"],
    async execute(businessId) {
      const res = await query(
        `SELECT
           COUNT(*) AS total_products,
           COALESCE(SUM(stock_quantity * unit_cost), 0) AS total_value,
           COUNT(*) FILTER (WHERE stock_quantity <= min_stock_threshold) AS low_stock_count,
           COUNT(*) FILTER (WHERE stock_quantity = 0) AS out_of_stock_count
         FROM products
         WHERE business_id = $1`,
        [businessId]
      );
      const row = res.rows[0] || {};
      return {
        output: {
          total_products: parseInt(row.total_products || "0", 10),
          total_value: parseFloat(row.total_value || "0"),
          low_stock_count: parseInt(row.low_stock_count || "0", 10),
          out_of_stock_count: parseInt(row.out_of_stock_count || "0", 10),
        },
        evidence: {
          query: "SELECT count, sum, filter FROM products",
          source: "inventory.products",
        },
      };
    },
  },
  {
    id: "task_overview",
    agent_type: "task_allocation",
    label: "Task Overview",
    patterns: ["task summary", "overdue task", "task overview", "what tasks", "task status", "pending task"],
    async execute(businessId) {
      const res = await query(
        `SELECT
           COUNT(*) AS total_tasks,
           COUNT(*) FILTER (WHERE status = 'pending') AS pending,
           COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
           COUNT(*) FILTER (WHERE status = 'completed') AS completed,
           COUNT(*) FILTER (WHERE deadline < now() AND status != 'completed') AS overdue
         FROM tasks
         WHERE business_id = $1`,
        [businessId]
      );
      const row = res.rows[0] || {};
      return {
        output: {
          total_tasks: parseInt(row.total_tasks || "0", 10),
          pending: parseInt(row.pending || "0", 10),
          in_progress: parseInt(row.in_progress || "0", 10),
          completed: parseInt(row.completed || "0", 10),
          overdue: parseInt(row.overdue || "0", 10),
        },
        evidence: {
          query: "SELECT count, filter FROM tasks",
          source: "tasks.overview",
        },
      };
    },
  },
  {
    id: "team_workload",
    agent_type: "task_allocation",
    label: "Team Workload",
    patterns: ["workload", "team workload", "who is busy", "assignment", "team capacity", "team members"],
    async execute(businessId) {
      const res = await query(
        `SELECT
           e.id,
           e.name,
           e.role,
           COUNT(ta.id) AS assigned_count,
           COUNT(ta.id) FILTER (WHERE t.status = 'in_progress') AS active_count,
           COUNT(ta.id) FILTER (WHERE t.deadline < now() AND t.status != 'completed') AS overdue_count
         FROM employees e
         LEFT JOIN task_assignments ta ON ta.employee_id = e.id AND ta.status = 'active'
         LEFT JOIN tasks t ON t.id = ta.task_id AND t.business_id = e.business_id
         WHERE e.business_id = $1
         GROUP BY e.id, e.name, e.role
         ORDER BY assigned_count DESC
         LIMIT 20`,
        [businessId]
      );
      return {
        output: {
          team: res.rows.map((r) => ({
            id: r.id,
            name: r.name,
            role: r.role,
            assigned: parseInt(r.assigned_count || "0", 10),
            active: parseInt(r.active_count || "0", 10),
            overdue: parseInt(r.overdue_count || "0", 10),
          })),
          count: res.rows.length,
        },
        evidence: {
          query: "SELECT employees LEFT JOIN task_assignments LEFT JOIN tasks GROUP BY",
          row_count: res.rows.length,
          source: "tasks.team_workload",
        },
      };
    },
  },
  {
    id: "financial_overview",
    agent_type: "financial",
    label: "Financial Overview",
    patterns: ["financial summary", "financial overview", "revenue", "invoice summary", "cashflow", "cash flow", "outstanding"],
    async execute(businessId) {
      const res = await query(
        `SELECT
           COUNT(*) AS total_invoices,
           COUNT(*) FILTER (WHERE status = 'draft') AS draft,
           COUNT(*) FILTER (WHERE status = 'unpaid') AS unpaid,
           COUNT(*) FILTER (WHERE status = 'partially_paid') AS partially_paid,
           COUNT(*) FILTER (WHERE status = 'paid') AS paid,
           COUNT(*) FILTER (WHERE status = 'overdue') AS overdue,
           COALESCE(SUM(total), 0) AS total_revenue,
           COALESCE(SUM(total) FILTER (WHERE status = 'paid'), 0) AS collected,
           COALESCE(SUM(total) FILTER (WHERE status IN ('unpaid', 'partially_paid', 'overdue')), 0) AS outstanding
         FROM invoices
         WHERE business_id = $1`,
        [businessId]
      );
      const row = res.rows[0] || {};
      return {
        output: {
          total_invoices: parseInt(row.total_invoices || "0", 10),
          draft: parseInt(row.draft || "0", 10),
          unpaid: parseInt(row.unpaid || "0", 10),
          partially_paid: parseInt(row.partially_paid || "0", 10),
          paid: parseInt(row.paid || "0", 10),
          overdue: parseInt(row.overdue || "0", 10),
          total_revenue: parseFloat(row.total_revenue || "0"),
          collected: parseFloat(row.collected || "0"),
          outstanding: parseFloat(row.outstanding || "0"),
        },
        evidence: {
          query: "SELECT count, sum, filter FROM invoices",
          source: "financials.overview",
        },
      };
    },
  },
  {
    id: "customer_summary",
    agent_type: "financial",
    label: "Customer Summary",
    patterns: ["customer summary", "how many customers", "customer list", "client"],
    async execute(businessId) {
      const res = await query(
        `SELECT
           COUNT(*) AS total_customers,
           COUNT(*) FILTER (WHERE created_at > now() - interval '30 days') AS new_this_month
         FROM customers
         WHERE business_id = $1`,
        [businessId]
      );
      const row = res.rows[0] || {};
      return {
        output: {
          total_customers: parseInt(row.total_customers || "0", 10),
          new_this_month: parseInt(row.new_this_month || "0", 10),
        },
        evidence: {
          query: "SELECT count FROM customers",
          source: "financials.customers",
        },
      };
    },
  },
  {
    id: "marketing_overview",
    agent_type: "marketing",
    label: "Marketing Overview",
    patterns: ["marketing summary", "marketing overview", "campaign status", "marketing status", "how many campaigns"],
    async execute(businessId) {
      const res = await query(
        `SELECT
           COUNT(*) AS total_projects,
           COUNT(*) FILTER (WHERE status = 'draft') AS draft,
           COUNT(*) FILTER (WHERE status = 'active') AS active,
           COUNT(*) FILTER (WHERE status = 'completed') AS completed,
           (SELECT COUNT(*) FROM marketing_drafts md
            WHERE md.business_id = $1) AS total_drafts,
           (SELECT COUNT(*) FROM pitch_decks pd
            WHERE pd.business_id = $1) AS total_pitch_decks
         FROM marketing_projects
         WHERE business_id = $1`,
        [businessId]
      );
      const row = res.rows[0] || {};
      return {
        output: {
          total_projects: parseInt(row.total_projects || "0", 10),
          draft: parseInt(row.draft || "0", 10),
          active: parseInt(row.active || "0", 10),
          completed: parseInt(row.completed || "0", 10),
          total_drafts: parseInt(row.total_drafts || "0", 10),
          total_pitch_decks: parseInt(row.total_pitch_decks || "0", 10),
        },
        evidence: {
          query: "SELECT count, filter FROM marketing_projects",
          source: "marketing.overview",
        },
      };
    },
  },
];

// Combined registry: existing 7 intents + inventory specialist agent intents.
// Must be declared AFTER INTENT_REGISTRY is defined.
const ALL_INTENTS = [...INTENT_REGISTRY, ...INVENTORY_INTENTS];

// --- Intent Matching ----------------------------------------------------

/**
 * Match the user's goal text against known intent patterns.
 * A single goal can match multiple intents (e.g., "low stock and overdue tasks").
 *
 * @param {string} goalText - The user's natural-language goal
 * @returns {Array<object>} Array of matched intent definitions
 */
export function matchIntents(goalText) {
  if (!goalText || typeof goalText !== "string") return [];
  const lower = goalText.toLowerCase().trim();

  const matched = [];
  for (const intent of ALL_INTENTS) {
    if (intent.patterns.some((p) => lower.includes(p))) {
      matched.push(intent);
    }
  }

  return matched;
}

// --- Formatter ----------------------------------------------------------

/**
 * Format an intent's output into a human-readable summary string.
 */
function formatStepSummary(intent, output) {
  switch (intent.id) {
    case "low_stock":
      if (output.count === 0) return "No low-stock items found — all products are above reorder levels.";
      const items = output.items.slice(0, 5).map((i) =>
        `  • ${i.name} (SKU: ${i.sku || "N/A"}) — ${i.stock_quantity} units, reorder at ${i.min_stock_threshold}`
      ).join("\n");
      const extra = output.count > 5 ? `\n  ...and ${output.count - 5} more.` : "";
      return `Found ${output.count} low-stock item(s):\n${items}${extra}`;

    case "inventory_summary":
      return `Inventory: ${output.total_products} products, total value $${output.total_value.toFixed(2)}. ${output.low_stock_count} low-stock, ${output.out_of_stock_count} out of stock.`;

    case "task_overview":
      return `Tasks: ${output.total_tasks} total — ${output.pending} pending, ${output.in_progress} in progress, ${output.completed} completed, ${output.overdue} overdue.`;

    case "team_workload":
      if (output.count === 0) return "No team members found.";
      const team = output.team.slice(0, 5).map((t) =>
        `  • ${t.name} (${t.role}) — ${t.assigned} assigned, ${t.active} active, ${t.overdue} overdue`
      ).join("\n");
      return `Team workload (${output.count} members):\n${team}`;

    case "financial_overview":
      return `Financials: ${output.total_invoices} invoices — ${output.paid} paid, ${output.unpaid} unpaid, ${output.partially_paid} partially paid, ${output.overdue} overdue. Collected: $${output.collected.toFixed(2)}, Outstanding: $${output.outstanding.toFixed(2)}.`;

    case "customer_summary":
      return `Customers: ${output.total_customers} total, ${output.new_this_month} new this month.`;

    case "marketing_overview":
      return `Marketing: ${output.total_projects} projects (${output.active} active, ${output.draft} draft, ${output.completed} completed). ${output.total_drafts} drafts, ${output.total_pitch_decks} pitch decks.`;

    // --- Inventory Specialist Agent intents ---

    case "product_search":
      if (output.search_term === null) {
        return output.message || "Please specify a product name or SKU to search for.";
      }
      if (output.count === 0) {
        return `No products found matching "${output.search_term}". Try a different name or SKU.`;
      }
      const psItems = output.items.slice(0, 5).map((i) =>
        `  • ${i.name} (SKU: ${i.sku || "N/A"}) — ${i.stock_quantity} in stock, cost $${parseFloat(i.unit_cost || 0).toFixed(2)}`
      ).join("\n");
      const psExtra = output.count > 5 ? `\n  ...and ${output.count - 5} more.` : "";
      return `Found ${output.count} product(s) matching "${output.search_term}":\n${psItems}${psExtra}`;

    case "near_expiry":
      if (output.expired_count === 0 && output.expiring_soon_count === 0) {
        return "No products have expiry dates within the next 7 days, and no products have already expired.";
      }
      const expiredItems = output.expired.slice(0, 5).map((i) =>
        `  • ${i.name} (SKU: ${i.sku || "N/A"}) — expired on ${i.expiry_date}, ${i.stock_quantity} in stock`
      ).join("\n");
      const soonItems = output.expiring_soon.slice(0, 5).map((i) =>
        `  • ${i.name} (SKU: ${i.sku || "N/A"}) — expires on ${i.expiry_date}, ${i.stock_quantity} in stock`
      ).join("\n");
      const parts = [];
      if (output.expired_count > 0) {
        parts.push(`${output.expired_count} expired product(s):\n${expiredItems}`);
      }
      if (output.expiring_soon_count > 0) {
        parts.push(`${output.expiring_soon_count} product(s) expiring within 7 days:\n${soonItems}`);
      }
      return parts.join("\n\n");

    case "stock_movement_history":
      if (output.count === 0) return "No stock movements have been recorded yet.";
      const smItems = output.movements.slice(0, 5).map((m) =>
        `  • ${m.product_name} (SKU: ${m.product_sku || "N/A"}) — ${m.movement_type} ${m.quantity_change > 0 ? "+" : ""}${m.quantity_change} on ${new Date(m.created_at).toLocaleDateString()}`
      ).join("\n");
      const smExtra = output.count > 5 ? `\n  ...and ${output.count - 5} more.` : "";
      return `Recent stock movements (${output.count} total):\n${smItems}${smExtra}`;

    case "inventory_by_supplier":
      if (output.count === 0) return "No products found in inventory.";
      const supItems = output.suppliers.slice(0, 8).map((s) =>
        `  • ${s.supplier_name}: ${s.product_count} products, ${s.total_stock} units, value $${parseFloat(s.total_value || 0).toFixed(2)}`
      ).join("\n");
      return `Inventory by supplier (${output.count} groups):\n${supItems}`;

    default:
      return "Operation completed.";
  }
}

function formatFallbackResponse(goal) {
  return `I couldn't find a specific action for "${goal}". Here's what I can help with:\n\n` +
    "  • \"show low stock\" — list products at or below reorder level\n" +
    "  • \"inventory summary\" — total products, value, and stock status\n" +
    "  • \"find product [name]\" — search products by name, SKU, or description\n" +
    "  • \"near expiry\" — products that are expired or expiring within 7 days\n" +
    "  • \"stock movement\" — recent stock movement history\n" +
    "  • \"by supplier\" — inventory value grouped by supplier\n" +
    "  • \"task overview\" — pending, active, completed, and overdue tasks\n" +
    "  • \"team workload\" — per-member task assignments and capacity\n" +
    "  • \"financial overview\" — invoices, revenue, and outstanding amounts\n" +
    "  • \"customer summary\" — total and new customers\n" +
    "  • \"marketing overview\" — projects, drafts, and pitch decks\n\n" +
    "Try asking about any of these topics.";
}

// --- Coordinator Runner -------------------------------------------------

/**
 * Run the full coordinator flow for a single user goal.
 *
 * @param {object} params
 * @param {string} params.businessId - Verified business UUID from middleware
 * @param {string} params.userId - Verified user UUID from middleware
 * @param {string} params.goal - User's natural-language goal
 * @returns {Promise<object>} Agent run result with steps and final report
 */
export async function runCoordinator({ businessId, userId, goal }) {
  const agentRunId = randomUUID();

  // 1. Create agent_run record
  await query(
    `INSERT INTO agent_runs (id, business_id, user_id, goal, status, started_at)
     VALUES ($1, $2, $3, $4, 'planning', now())`,
    [agentRunId, businessId, userId, goal]
  );

  try {
    // 2. Update status to executing
    await query(
      `UPDATE agent_runs SET status = 'executing' WHERE id = $1`,
      [agentRunId]
    );

    // 3. Match intents
    const intents = matchIntents(goal);

    if (intents.length === 0) {
      // No intent matched — return helpful fallback (not an error)
      const fallbackReport = {
        summary: formatFallbackResponse(goal),
        matched_intents: [],
        capabilities: [...INTENT_REGISTRY.map((i) => i.id), ...getInventoryIntentIds()],
      };

      await query(
        `UPDATE agent_runs
         SET status = 'completed', final_report = $1, completed_at = now()
         WHERE id = $2`,
        [JSON.stringify(fallbackReport), agentRunId]
      );

      // Audit log
      await query(
        `INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
         VALUES ($1, $2, 'agent_run_completed', 'agent_run', $3, $4)`,
        [businessId, userId, agentRunId, JSON.stringify({ goal, matched: 0, fallback: true })]
      );

      return {
        agent_run_id: agentRunId,
        status: "completed",
        goal,
        steps: [],
        final_report: fallbackReport,
      };
    }

    // 4. Execute each matched intent as a step
    const steps = [];

    for (let i = 0; i < intents.length; i++) {
      const intent = intents[i];
      const stepId = randomUUID();
      const stepInput = { intent: intent.id, label: intent.label, source: intent.source || "coordinator" };

      // Create step record (pending)
      await query(
        `INSERT INTO agent_run_steps
           (id, agent_run_id, agent_type, step_number, status, input)
         VALUES ($1, $2, $3, $4, 'pending', $5)`,
        [stepId, agentRunId, intent.agent_type, i + 1, JSON.stringify(stepInput)]
      );

      try {
        // Update to executing
        await query(
          `UPDATE agent_run_steps SET status = 'executing' WHERE id = $1`,
          [stepId]
        );

        // Execute the real query
        // Pass goal so inventory intents (e.g. product_search) can extract
        // a search term from the user's natural-language input.
        const { output, evidence } = await intent.execute(businessId, goal);

        const stepOutput = { ...output, _summary: formatStepSummary(intent, output) };

        // Update step to completed
        await query(
          `UPDATE agent_run_steps
           SET status = 'completed', output = $1, evidence = $2
           WHERE id = $3`,
          [JSON.stringify(stepOutput), JSON.stringify(evidence), stepId]
        );

        // Write audit log
        await query(
          `INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            businessId,
            userId,
            `agent_step_${intent.id}`,
            intent.agent_type,
            stepId,
            JSON.stringify({ intent: intent.id, source: intent.source || "coordinator", evidence }),
          ]
        );

        steps.push({
          id: stepId,
          agent_type: intent.agent_type,
          step_number: i + 1,
          status: "completed",
          input: stepInput,
          output: stepOutput,
          evidence,
        });
      } catch (stepErr) {
        // Step failed — record error, continue to next step
        const errorMsg = stepErr.message || "Step execution failed";

        await query(
          `UPDATE agent_run_steps
           SET status = 'failed', error = $1
           WHERE id = $2`,
          [errorMsg, stepId]
        );

        // Audit log for failure
        await query(
          `INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            businessId,
            userId,
            `agent_step_${intent.id}_failed`,
            intent.agent_type,
            stepId,
            JSON.stringify({ intent: intent.id, source: intent.source || "coordinator", error: errorMsg }),
          ]
        );

        steps.push({
          id: stepId,
          agent_type: intent.agent_type,
          step_number: i + 1,
          status: "failed",
          input: stepInput,
          error: errorMsg,
        });
      }
    }

    // 5. Aggregate final report
    const summaries = steps
      .filter((s) => s.status === "completed" && s.output?._summary)
      .map((s) => s.output._summary);

    const finalReport = {
      summary: summaries.length > 0
        ? summaries.join("\n\n")
        : "No results returned from executed steps.",
      matched_intents: intents.map((i) => i.id),
      step_count: steps.length,
      completed: steps.filter((s) => s.status === "completed").length,
      failed: steps.filter((s) => s.status === "failed").length,
    };

    // 6. Update agent_run to completed
    await query(
      `UPDATE agent_runs
       SET status = 'completed', final_report = $1, completed_at = now()
       WHERE id = $2`,
      [JSON.stringify(finalReport), agentRunId]
    );

    // Final audit log
    await query(
      `INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
       VALUES ($1, $2, 'agent_run_completed', 'agent_run', $3, $4)`,
      [
        businessId,
        userId,
        agentRunId,
        JSON.stringify({
          goal,
          matched: intents.length,
          completed: finalReport.completed,
          failed: finalReport.failed,
        }),
      ]
    );

    return {
      agent_run_id: agentRunId,
      status: "completed",
      goal,
      steps,
      final_report: finalReport,
    };
  } catch (err) {
    // Catastrophic failure — mark agent_run as failed
    await query(
      `UPDATE agent_runs
       SET status = 'failed', completed_at = now()
       WHERE id = $1`,
      [agentRunId]
    );

    await query(
      `INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
       VALUES ($1, $2, 'agent_run_failed', 'agent_run', $3, $4)`,
      [
        businessId,
        userId,
        agentRunId,
        JSON.stringify({ goal, error: err.message || "Unknown error" }),
      ]
    );

    throw err;
  }
}

// --- List Agent Runs (for history) -------------------------------------

/**
 * List recent agent runs for a business.
 *
 * @param {string} businessId
 * @param {object} options - { limit, offset }
 * @returns {Promise<Array>}
 */
export async function listAgentRuns(businessId, { limit = 20, offset = 0 } = {}) {
  const res = await query(
    `SELECT id, goal, status, started_at, completed_at,
            (final_report->>'summary') AS summary
     FROM agent_runs
     WHERE business_id = $1
     ORDER BY started_at DESC
     LIMIT $2 OFFSET $3`,
    [businessId, limit, offset]
  );
  return res.rows;
}

/**
 * Get a single agent run with its steps.
 *
 * @param {string} businessId
 * @param {string} runId
 * @returns {Promise<object|null>}
 */
export async function getAgentRun(businessId, runId) {
  const runRes = await query(
    `SELECT id, goal, status, started_at, completed_at, plan, final_report
     FROM agent_runs
     WHERE id = $1 AND business_id = $2`,
    [runId, businessId]
  );

  if (runRes.rows.length === 0) return null;

  const stepsRes = await query(
    `SELECT id, agent_type, step_number, status, input, output, evidence, error
     FROM agent_run_steps
     WHERE agent_run_id = $1
     ORDER BY step_number ASC`,
    [runId]
  );

  return {
    ...runRes.rows[0],
    steps: stepsRes.rows,
  };
}
