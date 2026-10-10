/**
 * routes/inventory.js — Smart Stock & Inventory API.
 *
 * All routes in this router are prefixed with:
 *   /api/businesses/:businessId/inventory
 *
 * Every route requires BOTH:
 *   1. authenticateToken  — verifies the JWT
 *   2. requireBusinessAccess — verifies business membership
 *
 * These are applied at the router level so no route can be left unprotected.
 *
 * Endpoints:
 *   Products:
 *     POST   /products                    — Create a product
 *     GET    /products                    — List products (pagination + search + active filter)
 *     GET    /products/:productId         — Get a single product (with supplier info)
 *     PATCH  /products/:productId         — Update product (NOT stock_quantity — protected)
 *     POST   /products/:productId/deactivate — Deactivate a product (set is_active = false)
 *
 *   Suppliers:
 *     POST   /suppliers                   — Create a supplier
 *     GET    /suppliers                   — List suppliers (pagination + search)
 *     GET    /suppliers/:supplierId       — Get a single supplier
 *     PATCH  /suppliers/:supplierId       — Update a supplier
 *
 *   Stock Movements:
 *     POST   /products/:productId/stock-movements — Record a stock movement (transactional)
 *     GET    /products/:productId/stock-movements — List movements for a product
 *     GET    /stock-movements             — List all movements (pagination + type filter)
 *
 *   Inventory Overview:
 *     GET    /overview                    — Summary: total products, stock value, low-stock count
 *     GET    /low-stock                   — Products at or below min_stock_threshold
 *
 * Stock correctness:
 *   - stock_quantity is protected by a DB trigger (protect_stock_quantity).
 *     It can ONLY change via an INSERT into stock_movements, which triggers
 *     apply_stock_movement() to update the product's stock_quantity.
 *   - The app layer NEVER directly updates stock_quantity.
 *   - Before recording a stock-out movement, the app checks that the
 *     resulting stock won't go negative (app-level check + DB CHECK constraint).
 *   - SELECT FOR UPDATE on the product row serializes concurrent movements.
 *   - stock_movements is append-only (trigger blocks UPDATE/DELETE).
 */

import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { withTransaction } from "../utils/transaction.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authenticateToken } from "../middleware/auth.js";
import { requireBusinessAccess } from "../middleware/businessAuth.js";
import {
  BadRequestError,
  NotFoundError,
} from "../utils/errors.js";

const router = Router({ mergeParams: true });

// Apply auth + business access to ALL routes in this router
router.use(authenticateToken, requireBusinessAccess);

// ===================================================================
// Helpers (reused from financials.js patterns)
// ===================================================================

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePagination(queryObj) {
  let page = parseInt(queryObj.page, 10);
  let limit = parseInt(queryObj.limit, 10);
  if (!Number.isInteger(page) || page < 1) page = 1;
  if (!Number.isInteger(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  return { page, limit, offset: (page - 1) * limit };
}

function requireUUID(value, name) {
  if (!value || !UUID_RE.test(value)) {
    throw new BadRequestError(`${name} must be a valid UUID`);
  }
  return value;
}

function formatZodError(parsed) {
  return {
    errors: parsed.error.issues.map((i) => ({
      field: i.path.join("."),
      message: i.message,
    })),
  };
}

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

// Movement types and their required quantity sign
// positive = stock in, negative = stock out
const MOVEMENT_TYPES = ["purchase", "sale", "adjustment", "return", "transfer", "writeoff"];
const POSITIVE_TYPES = ["purchase", "return"];
const NEGATIVE_TYPES = ["sale", "writeoff"];
const EITHER_TYPES = ["adjustment", "transfer"];

// ===================================================================
// Zod Validation Schemas
// ===================================================================

const createSupplierSchema = z.object({
  name: z.string().min(1, "Supplier name is required").max(200),
  contact_name: z.string().max(200).optional().nullable(),
  email: z.string().email("Invalid email format").max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
});

const updateSupplierSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  contact_name: z.string().max(200).optional().nullable(),
  email: z.string().email("Invalid email format").max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
});

const createProductSchema = z.object({
  name: z.string().min(1, "Product name is required").max(200),
  sku: z.string().min(1, "SKU is required").max(50, "SKU is too long"),
  description: z.string().max(2000).optional().nullable(),
  min_stock_threshold: z.number().nonnegative().optional().default(0),
  unit_cost: z.number().nonnegative().optional().default(0),
  expiry_date: dateSchema.optional().nullable(),
  supplier_id: z.string().uuid("Supplier ID must be a valid UUID").optional().nullable(),
  is_active: z.boolean().optional().default(true),
});

const updateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sku: z.string().min(1).max(50).optional(),
  description: z.string().max(2000).optional().nullable(),
  min_stock_threshold: z.number().nonnegative().optional(),
  unit_cost: z.number().nonnegative().optional(),
  expiry_date: dateSchema.optional().nullable(),
  supplier_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().optional(),
  // NOTE: stock_quantity is intentionally NOT in this schema —
  // it's protected by a DB trigger and can only change via stock_movements
});

const createStockMovementSchema = z.object({
  movement_type: z.enum(MOVEMENT_TYPES),
  quantity_change: z.number().refine((v) => v !== 0, "Quantity change must not be zero"),
  reason: z.string().max(500).optional().nullable(),
  reference_type: z.string().max(100).optional().nullable(),
  reference_id: z.string().uuid().optional().nullable(),
});

// ===================================================================
// SUPPLIER ROUTES
// ===================================================================

// --- POST /suppliers — Create a supplier ---------------------------

router.post(
  "/suppliers",
  asyncHandler(async (req, res) => {
    const parsed = createSupplierSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const { name, contact_name, email, phone, address } = parsed.data;
    const businessId = req.businessId;

    const result = await query(
      `INSERT INTO suppliers (business_id, name, contact_name, email, phone, address)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, business_id, name, contact_name, email, phone, address,
         created_at, updated_at`,
      [businessId, name, contact_name ?? null, email ?? null, phone ?? null, address ?? null]
    );

    res.status(201).json(result.rows[0]);
  })
);

// --- GET /suppliers — List suppliers (pagination + search) ---------

router.get(
  "/suppliers",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const { page, limit, offset } = parsePagination(req.query);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

    let result, countResult;

    if (search) {
      const pattern = `%${search}%`;
      countResult = await query(
        `SELECT COUNT(*)::int AS total FROM suppliers
         WHERE business_id = $1
           AND (name ILIKE $2 OR contact_name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2)`,
        [businessId, pattern]
      );
      result = await query(
        `SELECT id, business_id, name, contact_name, email, phone, address,
            created_at, updated_at
         FROM suppliers
         WHERE business_id = $1
           AND (name ILIKE $2 OR contact_name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2)
         ORDER BY name ASC
         LIMIT $3 OFFSET $4`,
        [businessId, pattern, limit, offset]
      );
    } else {
      countResult = await query(
        "SELECT COUNT(*)::int AS total FROM suppliers WHERE business_id = $1",
        [businessId]
      );
      result = await query(
        `SELECT id, business_id, name, contact_name, email, phone, address,
            created_at, updated_at
         FROM suppliers
         WHERE business_id = $1
         ORDER BY name ASC
         LIMIT $2 OFFSET $3`,
        [businessId, limit, offset]
      );
    }

    const total = countResult.rows[0]?.total ?? 0;

    res.json({
      data: result.rows,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 0 },
    });
  })
);

// --- GET /suppliers/:supplierId — Get a single supplier ------------

router.get(
  "/suppliers/:supplierId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const supplierId = requireUUID(req.params.supplierId, "Supplier ID");

    const result = await query(
      `SELECT id, business_id, name, contact_name, email, phone, address,
          created_at, updated_at
       FROM suppliers
       WHERE id = $1 AND business_id = $2`,
      [supplierId, businessId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Supplier not found");
    }

    res.json(result.rows[0]);
  })
);

// --- PATCH /suppliers/:supplierId — Update a supplier --------------

router.patch(
  "/suppliers/:supplierId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const supplierId = requireUUID(req.params.supplierId, "Supplier ID");

    const parsed = updateSupplierSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const fields = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, val] of Object.entries(parsed.data)) {
      if (val === undefined) continue;
      fields.push(`${key} = $${paramIndex}`);
      values.push(val ?? null);
      paramIndex++;
    }

    if (fields.length === 0) {
      throw new BadRequestError("No fields provided to update");
    }

    values.push(supplierId);
    const idParam = paramIndex++;
    values.push(businessId);
    const bizParam = paramIndex;

    const result = await query(
      `UPDATE suppliers SET ${fields.join(", ")}, updated_at = now()
       WHERE id = $${idParam} AND business_id = $${bizParam}
       RETURNING id, business_id, name, contact_name, email, phone, address,
          created_at, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Supplier not found");
    }

    res.json(result.rows[0]);
  })
);

// ===================================================================
// PRODUCT ROUTES
// ===================================================================

// --- POST /products — Create a product -----------------------------

router.post(
  "/products",
  asyncHandler(async (req, res) => {
    const parsed = createProductSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const { name, sku, description, min_stock_threshold, unit_cost, expiry_date, supplier_id, is_active } =
      parsed.data;

    // Verify supplier belongs to this business (if provided)
    if (supplier_id) {
      const supplierCheck = await query(
        "SELECT id FROM suppliers WHERE id = $1 AND business_id = $2",
        [supplier_id, businessId]
      );
      if (supplierCheck.rows.length === 0) {
        throw new BadRequestError(
          "Supplier does not exist or does not belong to this business"
        );
      }
    }

    const result = await query(
      `INSERT INTO products
         (business_id, name, sku, description, stock_quantity, min_stock_threshold,
          unit_cost, expiry_date, supplier_id, is_active)
       VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9)
       RETURNING id, business_id, name, sku, description, stock_quantity,
          min_stock_threshold, unit_cost, expiry_date, supplier_id, is_active,
          created_at, updated_at`,
      [
        businessId,
        name,
        sku,
        description ?? null,
        min_stock_threshold,
        unit_cost,
        expiry_date ?? null,
        supplier_id ?? null,
        is_active,
      ]
    );

    res.status(201).json(result.rows[0]);
  })
);

// --- GET /products — List products (pagination + search + filter) --

router.get(
  "/products",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const { page, limit, offset } = parsePagination(req.query);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const activeFilter = req.query.active;

    // Build WHERE clauses dynamically — must use p. prefix because of
    // the LEFT JOIN with suppliers (both tables have business_id, name, etc.)
    const conditions = ["p.business_id = $1"];
    const params = [businessId];
    let paramIdx = 2;

    if (search) {
      const pattern = `%${search}%`;
      conditions.push(`(p.name ILIKE $${paramIdx} OR p.sku ILIKE $${paramIdx} OR p.description ILIKE $${paramIdx})`);
      params.push(pattern);
      paramIdx++;
    }

    if (activeFilter === "true" || activeFilter === "false") {
      conditions.push(`p.is_active = $${paramIdx}`);
      params.push(activeFilter === "true");
      paramIdx++;
    }

    const whereClause = conditions.join(" AND ");

    const countResult = await query(
      `SELECT COUNT(*)::int AS total FROM products p WHERE ${whereClause}`,
      params
    );

    params.push(limit);
    const limitParam = paramIdx++;
    params.push(offset);
    const offsetParam = paramIdx;

    const result = await query(
      `SELECT p.id, p.business_id, p.name, p.sku, p.description, p.stock_quantity,
          p.min_stock_threshold, p.unit_cost, p.expiry_date, p.supplier_id,
          p.is_active, p.created_at, p.updated_at,
          s.name AS supplier_name
       FROM products p
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       WHERE ${whereClause}
       ORDER BY p.name ASC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params
    );

    const total = countResult.rows[0]?.total ?? 0;

    res.json({
      data: result.rows,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 0 },
    });
  })
);

// --- GET /products/:productId — Get a single product ----------------

router.get(
  "/products/:productId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const productId = requireUUID(req.params.productId, "Product ID");

    const result = await query(
      `SELECT p.id, p.business_id, p.name, p.sku, p.description, p.stock_quantity,
          p.min_stock_threshold, p.unit_cost, p.expiry_date, p.supplier_id,
          p.is_active, p.created_at, p.updated_at,
          s.name AS supplier_name, s.email AS supplier_email, s.phone AS supplier_phone
       FROM products p
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       WHERE p.id = $1 AND p.business_id = $2`,
      [productId, businessId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Product not found");
    }

    res.json(result.rows[0]);
  })
);

// --- PATCH /products/:productId — Update a product ------------------

router.patch(
  "/products/:productId",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const productId = requireUUID(req.params.productId, "Product ID");

    const parsed = updateProductSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    // Verify supplier belongs to this business (if being updated)
    if (parsed.data.supplier_id) {
      const supplierCheck = await query(
        "SELECT id FROM suppliers WHERE id = $1 AND business_id = $2",
        [parsed.data.supplier_id, businessId]
      );
      if (supplierCheck.rows.length === 0) {
        throw new BadRequestError(
          "Supplier does not exist or does not belong to this business"
        );
      }
    }

    const fields = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, val] of Object.entries(parsed.data)) {
      if (val === undefined) continue;
      // Explicitly reject stock_quantity — protected field
      if (key === "stock_quantity") {
        throw new BadRequestError(
          "stock_quantity cannot be updated directly. Use stock movements instead."
        );
      }
      fields.push(`${key} = $${paramIndex}`);
      values.push(val ?? null);
      paramIndex++;
    }

    if (fields.length === 0) {
      throw new BadRequestError("No fields provided to update");
    }

    values.push(productId);
    const idParam = paramIndex++;
    values.push(businessId);
    const bizParam = paramIndex;

    const result = await query(
      `UPDATE products SET ${fields.join(", ")}, updated_at = now()
       WHERE id = $${idParam} AND business_id = $${bizParam}
       RETURNING id, business_id, name, sku, description, stock_quantity,
          min_stock_threshold, unit_cost, expiry_date, supplier_id, is_active,
          created_at, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      throw new NotFoundError("Product not found");
    }

    res.json(result.rows[0]);
  })
);

// --- POST /products/:productId/deactivate — Deactivate a product --

router.post(
  "/products/:productId/deactivate",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const productId = requireUUID(req.params.productId, "Product ID");

    const result = await query(
      `UPDATE products SET is_active = false, updated_at = now()
       WHERE id = $1 AND business_id = $2 AND is_active = true
       RETURNING id, business_id, name, sku, description, stock_quantity,
          min_stock_threshold, unit_cost, expiry_date, supplier_id, is_active,
          created_at, updated_at`,
      [productId, businessId]
    );

    if (result.rows.length === 0) {
      // Check if product exists at all
      const check = await query(
        "SELECT id, is_active FROM products WHERE id = $1 AND business_id = $2",
        [productId, businessId]
      );
      if (check.rows.length === 0) {
        throw new NotFoundError("Product not found");
      }
      // Already inactive — return current state
      throw new BadRequestError("Product is already deactivated");
    }

    res.json(result.rows[0]);
  })
);

// ===================================================================
// STOCK MOVEMENT ROUTES
// ===================================================================

// --- POST /products/:productId/stock-movements — Record movement ----

router.post(
  "/products/:productId/stock-movements",
  asyncHandler(async (req, res) => {
    const parsed = createStockMovementSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Validation failed", formatZodError(parsed));
    }

    const businessId = req.businessId;
    const productId = requireUUID(req.params.productId, "Product ID");
    const { movement_type, quantity_change, reason, reference_type, reference_id } =
      parsed.data;

    // Validate sign conventions for movement types
    if (POSITIVE_TYPES.includes(movement_type) && quantity_change <= 0) {
      throw new BadRequestError(
        `Movement type '${movement_type}' requires a positive quantity_change (stock in). Received: ${quantity_change}`
      );
    }
    if (NEGATIVE_TYPES.includes(movement_type) && quantity_change >= 0) {
      throw new BadRequestError(
        `Movement type '${movement_type}' requires a negative quantity_change (stock out). Received: ${quantity_change}`
      );
    }

    // Transactional: lock product → check stock sufficiency → insert movement
    // The apply_stock_movement() DB trigger auto-updates stock_quantity.
    const result = await withTransaction(async (client) => {
      // 1. Lock the product row (SELECT FOR UPDATE)
      //    This serializes concurrent stock movements on the same product.
      const productResult = await client.query(
        `SELECT id, business_id, stock_quantity, min_stock_threshold, is_active, name, sku
         FROM products
         WHERE id = $1 AND business_id = $2
         FOR UPDATE`,
        [productId, businessId]
      );

      if (productResult.rows.length === 0) {
        throw new NotFoundError("Product not found");
      }

      const product = productResult.rows[0];
      const currentStock = parseFloat(product.stock_quantity);
      const change = parseFloat(quantity_change);
      const newStock = currentStock + change;

      // 2. Check for negative stock BEFORE inserting
      //    The DB CHECK constraint (stock_quantity >= 0) would also catch this,
      //    but a clear app-level error message is better UX than a DB error.
      if (newStock < 0) {
        throw new BadRequestError(
          `Insufficient stock. Product '${product.name}' (SKU: ${product.sku}) ` +
            `has ${currentStock} units in stock. ` +
            `Attempted to remove ${Math.abs(change)} units. ` +
            `Resulting stock would be ${newStock} (negative).`
        );
      }

      // 3. Insert the stock movement
      //    The apply_stock_movement() trigger will automatically update
      //    products.stock_quantity. We do NOT update it manually.
      const movementResult = await client.query(
        `INSERT INTO stock_movements
           (product_id, business_id, movement_type, quantity_change, reason,
            reference_type, reference_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, product_id, business_id, movement_type, quantity_change,
            reason, reference_type, reference_id, created_at`,
        [
          productId,
          businessId,
          movement_type,
          change,
          reason ?? null,
          reference_type ?? null,
          reference_id ?? null,
        ]
      );

      // 4. Re-fetch the updated product to confirm new stock_quantity
      //    (the trigger has already applied the change)
      const updatedProduct = await client.query(
        `SELECT id, stock_quantity, min_stock_threshold, is_active
         FROM products WHERE id = $1`,
        [productId]
      );

      return {
        movement: movementResult.rows[0],
        product: updatedProduct.rows[0],
      };
    });

    res.status(201).json(result);
  })
);

// --- GET /products/:productId/stock-movements — List movements ------

router.get(
  "/products/:productId/stock-movements",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const productId = requireUUID(req.params.productId, "Product ID");
    const { page, limit, offset } = parsePagination(req.query);

    // Verify product exists and belongs to business
    const productCheck = await query(
      "SELECT id, name, sku FROM products WHERE id = $1 AND business_id = $2",
      [productId, businessId]
    );

    if (productCheck.rows.length === 0) {
      throw new NotFoundError("Product not found");
    }

    const countResult = await query(
      "SELECT COUNT(*)::int AS total FROM stock_movements WHERE product_id = $1 AND business_id = $2",
      [productId, businessId]
    );

    const result = await query(
      `SELECT id, product_id, business_id, movement_type, quantity_change,
          reason, reference_type, reference_id, created_at
       FROM stock_movements
       WHERE product_id = $1 AND business_id = $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [productId, businessId, limit, offset]
    );

    const total = countResult.rows[0]?.total ?? 0;

    res.json({
      product: productCheck.rows[0],
      data: result.rows,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 0 },
    });
  })
);

// --- GET /stock-movements — List all movements (filter by type) ----

router.get(
  "/stock-movements",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;
    const { page, limit, offset } = parsePagination(req.query);
    const typeFilter = typeof req.query.type === "string" ? req.query.type.trim() : "";

    let result, countResult;

    if (typeFilter && MOVEMENT_TYPES.includes(typeFilter)) {
      countResult = await query(
        "SELECT COUNT(*)::int AS total FROM stock_movements WHERE business_id = $1 AND movement_type = $2",
        [businessId, typeFilter]
      );
      result = await query(
        `SELECT sm.id, sm.product_id, sm.business_id, sm.movement_type,
            sm.quantity_change, sm.reason, sm.reference_type, sm.reference_id,
            sm.created_at,
            p.name AS product_name, p.sku AS product_sku
         FROM stock_movements sm
         JOIN products p ON sm.product_id = p.id
         WHERE sm.business_id = $1 AND sm.movement_type = $2
         ORDER BY sm.created_at DESC
         LIMIT $3 OFFSET $4`,
        [businessId, typeFilter, limit, offset]
      );
    } else {
      countResult = await query(
        "SELECT COUNT(*)::int AS total FROM stock_movements WHERE business_id = $1",
        [businessId]
      );
      result = await query(
        `SELECT sm.id, sm.product_id, sm.business_id, sm.movement_type,
            sm.quantity_change, sm.reason, sm.reference_type, sm.reference_id,
            sm.created_at,
            p.name AS product_name, p.sku AS product_sku
         FROM stock_movements sm
         JOIN products p ON sm.product_id = p.id
         WHERE sm.business_id = $1
         ORDER BY sm.created_at DESC
         LIMIT $2 OFFSET $3`,
        [businessId, limit, offset]
      );
    }

    const total = countResult.rows[0]?.total ?? 0;

    res.json({
      data: result.rows,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 0 },
    });
  })
);

// ===================================================================
// INVENTORY OVERVIEW ROUTES
// ===================================================================

// --- GET /overview — Summary of inventory health --------------------

router.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;

    const summary = await query(
      `SELECT
         COUNT(*)::int AS total_products,
         COUNT(*) FILTER (WHERE is_active = true)::int AS active_products,
         COUNT(*) FILTER (WHERE is_active = false)::int AS inactive_products,
         COUNT(*) FILTER (WHERE stock_quantity <= min_stock_threshold AND is_active = true)::int AS low_stock_count,
         COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + INTERVAL '7 days' AND is_active = true)::int AS near_expiry_count,
         COALESCE(SUM(stock_quantity * unit_cost), 0)::numeric(14,2) AS total_stock_value,
         COALESCE(SUM(stock_quantity), 0)::numeric(12,2) AS total_stock_units
       FROM products
       WHERE business_id = $1`,
      [businessId]
    );

    res.json(summary.rows[0]);
  })
);

// --- GET /low-stock — Products at or below threshold ---------------

router.get(
  "/low-stock",
  asyncHandler(async (req, res) => {
    const businessId = req.businessId;

    const result = await query(
      `SELECT p.id, p.business_id, p.name, p.sku, p.description, p.stock_quantity,
          p.min_stock_threshold, p.unit_cost, p.expiry_date, p.supplier_id,
          p.is_active, p.created_at, p.updated_at,
          s.name AS supplier_name,
          (p.stock_quantity * p.unit_cost)::numeric(12,2) AS stock_value,
          (p.min_stock_threshold - p.stock_quantity)::numeric(10,2) AS shortfall
       FROM products p
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       WHERE p.business_id = $1
         AND p.is_active = true
         AND p.stock_quantity <= p.min_stock_threshold
       ORDER BY (p.min_stock_threshold - p.stock_quantity) DESC,
                p.expiry_date ASC NULLS LAST`,
      [businessId]
    );

    res.json({
      data: result.rows,
      count: result.rows.length,
    });
  })
);

export default router;
