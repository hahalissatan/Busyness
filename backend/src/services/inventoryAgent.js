/**
 * services/inventoryAgent.js — Inventory Specialist Agent.
 *
 * Provides read-only inventory capabilities that extend the coordinator's
 * existing inventory intents (low_stock, inventory_summary) with:
 *   1. product_search       — look up products by name, SKU, or description
 *   2. near_expiry          — expired + soon-to-expire products
 *   3. stock_movement_history — recent stock movements
 *   4. inventory_by_supplier — stock value grouped by supplier
 *
 * Design principles:
 *   - All queries are SELECT-only — no business-data mutations.
 *   - Every query uses parameterized placeholders ($1, $2) with business_id
 *     from the authenticated request context — never from user input.
 *   - Results are capped at 20 rows to keep responses manageable.
 *   - Output structure: { output, evidence } — same as coordinator intents.
 *   - Each intent receives (businessId, goal) so product_search can
 *     extract a search term from the goal text.
 *
 * The coordinator imports INVENTORY_INTENTS and includes them in
 * matchIntents(). When an inventory intent is matched, the coordinator
 * delegates execution to intent.execute(businessId, goal).
 */

import { query } from "../db/pool.js";

// --- Helpers ---------------------------------------------------------------

/**
 * Extract a search term from the user's goal text.
 *
 * Strategy:
 *   1. Lowercase the goal.
 *   2. Remove the matched pattern phrase.
 *   3. Strip common filler words ("called", "named", "for", "me", "show",
 *      "find", "search", "look", "up", "product", "item", "the", "a", "an").
 *   4. Trim and return the remainder as the search term.
 *
 * Returns null if no usable search term remains.
 *
 * @param {string} goal - Original goal text
 * @param {string[]} patterns - Patterns that triggered this intent
 * @returns {string|null} Extracted search term, or null
 */
function extractSearchTerm(goal, patterns) {
  let lower = goal.toLowerCase().trim();

  // Remove the matched pattern phrase from the goal
  for (const p of patterns) {
    const idx = lower.indexOf(p);
    if (idx !== -1) {
      lower = (lower.slice(0, idx) + " " + lower.slice(idx + p.length)).trim();
    }
  }

  // Strip common filler words
  const filler = [
    "called", "named", "for", "me", "show", "find", "search",
    "look", "up", "product", "item", "the", "a", "an", "with",
    "about", "info", "details", "information",
  ];
  const words = lower.split(/\s+/).filter((w) => !filler.includes(w) && w.length > 0);
  const term = words.join(" ").trim();

  // Reject terms that are too short or just whitespace
  if (!term || term.length < 2) return null;
  return term;
}

// --- Intent Registry ------------------------------------------------------

export const INVENTORY_INTENTS = [
  // =================================================================
  // 1. product_search — look up products by name, SKU, or description
  // =================================================================
  {
    id: "product_search",
    agent_type: "inventory",
    label: "Product Search",
    source: "inventoryAgent",
    patterns: [
      "find product", "search product", "look up product",
      "product details", "product info",
    ],
    async execute(businessId, goal) {
      const searchTerm = extractSearchTerm(goal, this.patterns);

      if (!searchTerm) {
        return {
          output: {
            message:
              "Please specify a product name or SKU to search for. " +
              'Example: "find product coffee" or "search product SKU-001".',
            search_term: null,
          },
          evidence: {
            query: "no search term extracted",
            source: "inventory.products",
          },
        };
      }

      // Escape ILIKE wildcard characters (% and _) so the search term
      // is treated as a literal substring, not a pattern.
      const escapedTerm = searchTerm.replace(/[%_]/g, "\\$&");

      const res = await query(
        `SELECT id, name, sku, description, stock_quantity,
                min_stock_threshold, unit_cost,
                to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date,
                is_active
         FROM products
         WHERE business_id = $1
           AND is_active = true
           AND (name ILIKE $2 OR sku ILIKE $2 OR description ILIKE $2)
         ORDER BY name ASC
         LIMIT 20`,
        [businessId, `%${escapedTerm}%`]
      );

      return {
        output: {
          items: res.rows.map((r) => ({
            id: r.id,
            name: r.name,
            sku: r.sku,
            description: r.description,
            stock_quantity: parseFloat(r.stock_quantity),
            min_stock_threshold: parseFloat(r.min_stock_threshold),
            unit_cost: parseFloat(r.unit_cost),
            expiry_date: r.expiry_date,
            is_active: r.is_active,
          })),
          count: res.rows.length,
          search_term: searchTerm,
        },
        evidence: {
          query:
            "SELECT products WHERE name/sku/description ILIKE $term LIMIT 20",
          row_count: res.rows.length,
          source: "inventory.products",
        },
      };
    },
  },

  // =================================================================
  // 2. near_expiry — expired + soon-to-expire products (within 7 days)
  // =================================================================
  {
    id: "near_expiry",
    agent_type: "inventory",
    label: "Near Expiry Alert",
    source: "inventoryAgent",
    patterns: [
      "near expiry", "expiring", "about to expire",
      "expire soon", "expiry date", "expiring soon",
    ],
    async execute(businessId) {
      // Use to_char() to return dates as 'YYYY-MM-DD' strings.
      // pg returns DATE columns as JS Date objects, which break
      // string comparison (String(date) → "Sat Oct 10" not "2026-10-10").
      // Including today_date in the query ensures we use the same
      // date source (PostgreSQL CURRENT_DATE) for both the threshold
      // and the split logic.
      const res = await query(
        `SELECT id, name, sku, stock_quantity,
                to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date,
                to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today_date,
                unit_cost
         FROM products
         WHERE business_id = $1
           AND is_active = true
           AND expiry_date IS NOT NULL
           AND expiry_date <= CURRENT_DATE + INTERVAL '7 days'
         ORDER BY expiry_date ASC
         LIMIT 20`,
        [businessId]
      );

      // today_date from the database ensures consistency with
      // CURRENT_DATE used in the WHERE clause. Fallback to JS UTC
      // date only if the query returned zero rows.
      const todayStr =
        res.rows.length > 0
          ? res.rows[0].today_date
          : new Date().toISOString().slice(0, 10);

      const expired = [];
      const expiringSoon = [];

      for (const row of res.rows) {
        // expiry_date is already a 'YYYY-MM-DD' string from to_char.
        // Lexicographic comparison of ISO dates is equivalent to
        // chronological comparison.
        if (row.expiry_date < todayStr) {
          expired.push({
            id: row.id,
            name: row.name,
            sku: row.sku,
            stock_quantity: parseFloat(row.stock_quantity),
            expiry_date: row.expiry_date,
            unit_cost: parseFloat(row.unit_cost),
          });
        } else {
          expiringSoon.push({
            id: row.id,
            name: row.name,
            sku: row.sku,
            stock_quantity: parseFloat(row.stock_quantity),
            expiry_date: row.expiry_date,
            unit_cost: parseFloat(row.unit_cost),
          });
        }
      }

      return {
        output: {
          expired,
          expiring_soon: expiringSoon,
          expired_count: expired.length,
          expiring_soon_count: expiringSoon.length,
          days_threshold: 7,
        },
        evidence: {
          query:
            "SELECT products WHERE expiry_date <= CURRENT_DATE + 7 days (to_char date split in JS) LIMIT 20",
          row_count: res.rows.length,
          source: "inventory.products",
        },
      };
    },
  },

  // =================================================================
  // 3. stock_movement_history — 20 most recent stock movements
  // =================================================================
  {
    id: "stock_movement_history",
    agent_type: "inventory",
    label: "Stock Movement History",
    source: "inventoryAgent",
    patterns: [
      "stock movement", "recent movement", "stock history",
      "stock changes", "movement history",
    ],
    async execute(businessId) {
      const res = await query(
        `SELECT sm.id, sm.movement_type, sm.quantity_change, sm.reason,
                sm.created_at,
                p.name AS product_name, p.sku AS product_sku
         FROM stock_movements sm
         JOIN products p ON sm.product_id = p.id
         WHERE sm.business_id = $1
         ORDER BY sm.created_at DESC
         LIMIT 20`,
        [businessId]
      );

      return {
        output: {
          movements: res.rows.map((r) => ({
            id: r.id,
            movement_type: r.movement_type,
            quantity_change: parseFloat(r.quantity_change),
            reason: r.reason,
            created_at: r.created_at,
            product_name: r.product_name,
            product_sku: r.product_sku,
          })),
          count: res.rows.length,
        },
        evidence: {
          query:
            "SELECT stock_movements JOIN products ORDER BY created_at DESC LIMIT 20",
          row_count: res.rows.length,
          source: "inventory.stock_movements",
        },
      };
    },
  },

  // =================================================================
  // 4. inventory_by_supplier — stock value grouped by supplier
  // =================================================================
  {
    id: "inventory_by_supplier",
    agent_type: "inventory",
    label: "Inventory by Supplier",
    source: "inventoryAgent",
    patterns: [
      "by supplier", "supplier breakdown", "supplier inventory",
      "inventory by supplier", "supplier summary",
    ],
    async execute(businessId) {
      const res = await query(
        `SELECT
           COALESCE(s.name, 'No Supplier') AS supplier_name,
           COUNT(p.id) AS product_count,
           COALESCE(SUM(p.stock_quantity), 0) AS total_stock,
           COALESCE(SUM(p.stock_quantity * p.unit_cost), 0) AS total_value
         FROM products p
         LEFT JOIN suppliers s ON p.supplier_id = s.id AND s.business_id = $1
         WHERE p.business_id = $1 AND p.is_active = true
         GROUP BY s.id, s.name
         ORDER BY total_value DESC`,
        [businessId]
      );

      return {
        output: {
          suppliers: res.rows.map((r) => ({
            supplier_name: r.supplier_name,
            product_count: parseInt(r.product_count, 10),
            total_stock: parseFloat(r.total_stock),
            total_value: parseFloat(r.total_value),
          })),
          count: res.rows.length,
        },
        evidence: {
          query:
            "SELECT products LEFT JOIN suppliers GROUP BY supplier ORDER BY total_value DESC",
          row_count: res.rows.length,
          source: "inventory.suppliers",
        },
      };
    },
  },
];

// --- Export for coordinator integration ------------------------------------

/**
 * Get the list of inventory agent intent IDs (for fallback capability listing).
 * @returns {string[]}
 */
export function getInventoryIntentIds() {
  return INVENTORY_INTENTS.map((i) => i.id);
}
