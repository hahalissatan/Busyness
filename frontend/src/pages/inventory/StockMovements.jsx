/**
 * StockMovements — record and view stock movements.
 *
 * Backend contract (routes/inventory.js):
 *   POST /products/:productId/stock-movements  — Record movement (transactional)
 *   GET  /products/:productId/stock-movements   — List movements for a product
 *   GET  /stock-movements                        — List all movements (type filter)
 *
 * Movement schema: movement_type, quantity_change, reason, reference_type, reference_id
 *
 * Sign conventions:
 *   purchase, return    → must be positive (stock in)
 *   sale, writeoff      → must be negative (stock out)
 *   adjustment, transfer → can be either
 *
 * stock_movements is append-only (DB trigger blocks UPDATE/DELETE).
 * The apply_stock_movement() DB trigger auto-updates products.stock_quantity.
 *
 * Response shape for POST: { movement: {...}, product: {...} }
 * Response shape for GET /stock-movements: { data: [...], pagination: {...} }
 *   Each row: id, product_id, movement_type, quantity_change, reason,
 *             reference_type, reference_id, created_at, product_name, product_sku
 */

import { useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { DataTable } from "../../components/ui/DataTable.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { Plus } from "../../components/icons.jsx";

const MOVEMENT_TYPES = ["purchase", "return", "sale", "writeoff", "adjustment", "transfer"];

// Sign conventions: which types require positive, which require negative
const POSITIVE_TYPES = ["purchase", "return"]; // stock in
const NEGATIVE_TYPES = ["sale", "writeoff"]; // stock out
const EITHER_TYPES = ["adjustment", "transfer"]; // either

const EMPTY_FORM = {
  product_id: "",
  movement_type: "purchase",
  quantity: "", // user enters a magnitude (always positive in UI)
  direction: "in", // for adjustment/transfer: "in" or "out"
  reason: "",
  reference_type: "",
  reference_id: "",
};

export default function StockMovements() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/inventory`;
  const [modal, setModal] = useState(false);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [formError, setFormError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [typeFilter, setTypeFilter] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const openCreate = async () => {
    setFormError(null);
    try {
      const res = await api.list(`${base}/products`, { limit: 100, active: "true" });
      setProducts(res.data || []);
    } catch {
      setProducts([]);
    }
    setForm({ ...EMPTY_FORM });
    setModal(true);
  };

  const closeModal = () => {
    setModal(false);
    setFormError(null);
  };

  // Compute the signed quantity_change from the user's input
  const computeQuantityChange = () => {
    const magnitude = Math.abs(parseFloat(form.quantity));
    if (isNaN(magnitude)) return 0;

    if (POSITIVE_TYPES.includes(form.movement_type)) {
      return magnitude; // always positive
    } else if (NEGATIVE_TYPES.includes(form.movement_type)) {
      return -magnitude; // always negative
    } else {
      // adjustment or transfer — user picks direction
      return form.direction === "out" ? -magnitude : magnitude;
    }
  };

  // Preview the resulting stock for the selected product
  const getSelectedProduct = () => {
    return products.find((p) => p.id === form.product_id);
  };

  const save = async () => {
    if (submitting) return;
    setFormError(null);

    if (!form.product_id) {
      setFormError("Please select a product.");
      return;
    }
    if (!form.quantity || isNaN(parseFloat(form.quantity)) || parseFloat(form.quantity) === 0) {
      setFormError("Please enter a non-zero quantity.");
      return;
    }

    const quantityChange = computeQuantityChange();

    // Build payload — only fields in createStockMovementSchema
    const payload = {
      movement_type: form.movement_type,
      quantity_change: quantityChange,
      reason: form.reason || null,
      reference_type: form.reference_type || null,
      reference_id: form.reference_id || null,
    };

    setSubmitting(true);
    try {
      await api.post(`${base}/products/${form.product_id}/stock-movements`, payload);
      setModal(false);
      setForm({ ...EMPTY_FORM });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setFormError(err.message || "Failed to record stock movement.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleFilterChange = (v) => {
    setTypeFilter(v);
    setRefreshKey((k) => k + 1);
  };

  const typeColor = (t) =>
    ({
      purchase: "green",
      return: "green",
      sale: "yellow",
      writeoff: "red",
      adjustment: "blue",
      transfer: "blue",
    }[t] || "gray");

  // Helper: describe the sign convention for the current movement type
  const getSignHint = (type) => {
    if (POSITIVE_TYPES.includes(type)) return "Stock IN (positive)";
    if (NEGATIVE_TYPES.includes(type)) return "Stock OUT (negative)";
    return "Either direction";
  };

  const selectedProduct = getSelectedProduct();
  const resultingStock = selectedProduct
    ? parseFloat(selectedProduct.stock_quantity) + computeQuantityChange()
    : null;

  return (
    <div className="space-y-4">
      {/* Type filter */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-500">Filter:</label>
        <select
          className="input !py-1.5 !w-auto"
          value={typeFilter}
          onChange={(e) => handleFilterChange(e.target.value)}
        >
          <option value="">All types</option>
          {MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <DataTable
        key={refreshKey}
        columns={[
          {
            key: "product_name",
            label: "Product",
            render: (r) => <span className="font-medium">{r.product_name || "—"}</span>,
          },
          {
            key: "movement_type",
            label: "Type",
            render: (r) => <Badge color={typeColor(r.movement_type)}>{r.movement_type}</Badge>,
          },
          {
            key: "quantity_change",
            label: "Qty Change",
            render: (r) => {
              const val = parseFloat(r.quantity_change);
              const sign = val > 0 ? "+" : "";
              return (
                <span className={val > 0 ? "text-green-600 font-medium" : val < 0 ? "text-red-600 font-medium" : ""}>
                  {sign}
                  {val}
                </span>
              );
            },
          },
          { key: "reason", label: "Reason", render: (r) => r.reason || "—" },
          {
            key: "reference_type",
            label: "Ref Type",
            render: (r) => r.reference_type || "—",
          },
          {
            key: "created_at",
            label: "Date",
            render: (r) => new Date(r.created_at).toLocaleString(),
          },
        ]}
        fetchData={(params) => {
          const finalParams = { ...params };
          if (typeFilter) finalParams.type = typeFilter;
          return api.list(`${base}/stock-movements`, finalParams);
        }}
        searchPlaceholder="Search movements..."
        emptyTitle="No stock movements yet"
        emptyMessage="Record stock in/out to track your inventory changes."
        emptyIcon="📦"
        actions={{
          create: (
            <button onClick={openCreate} className="btn-primary">
              <Plus className="w-4 h-4" /> Record Movement
            </button>
          ),
        }}
      />

      {modal && (
        <Modal open onClose={closeModal} title="Record Stock Movement">
          <div className="space-y-4">
            {formError && (
              <div className="p-3 rounded-lg bg-red-50 text-red-800 text-sm">{formError}</div>
            )}

            {/* Product selector */}
            <div>
              <label className="label">Product</label>
              <select
                className="input"
                value={form.product_id}
                onChange={(e) => setForm({ ...form, product_id: e.target.value })}
              >
                <option value="">Select product...</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (SKU: {p.sku}, Stock: {p.stock_quantity})
                  </option>
                ))}
              </select>
            </div>

            {/* Movement type + quantity */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Movement Type</label>
                <select
                  className="input"
                  value={form.movement_type}
                  onChange={(e) => setForm({ ...form, movement_type: e.target.value })}
                >
                  {MOVEMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">{getSignHint(form.movement_type)}</p>
              </div>
              <div>
                <label className="label">Quantity</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Enter a positive number. Sign is applied automatically.
                </p>
              </div>
            </div>

            {/* Direction selector for adjustment/transfer */}
            {(EITHER_TYPES.includes(form.movement_type)) && (
              <div>
                <label className="label">Direction</label>
                <select
                  className="input !w-auto"
                  value={form.direction}
                  onChange={(e) => setForm({ ...form, direction: e.target.value })}
                >
                  <option value="in">Stock IN (+)</option>
                  <option value="out">Stock OUT (−)</option>
                </select>
              </div>
            )}

            {/* Stock preview */}
            {selectedProduct && form.quantity && !isNaN(parseFloat(form.quantity)) && (
              <div className="p-3 rounded-lg bg-blue-50 text-blue-800 text-sm space-y-1">
                <div>
                  Current stock: <strong>{selectedProduct.stock_quantity}</strong>
                </div>
                <div>
                  Quantity change:{" "}
                  <strong className={computeQuantityChange() >= 0 ? "text-green-700" : "text-red-700"}>
                    {computeQuantityChange() >= 0 ? "+" : ""}
                    {computeQuantityChange()}
                  </strong>
                </div>
                <div>
                  Resulting stock:{" "}
                  <strong className={resultingStock < 0 ? "text-red-700" : ""}>
                    {resultingStock}
                  </strong>
                  {resultingStock < 0 && (
                    <span className="text-red-600 font-normal"> — insufficient stock!</span>
                  )}
                </div>
              </div>
            )}

            {/* Reason + optional reference */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Reason (optional)</label>
                <input
                  className="input"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Reference Type (optional)</label>
                <input
                  className="input"
                  placeholder="e.g. purchase_order, invoice"
                  value={form.reference_type}
                  onChange={(e) => setForm({ ...form, reference_type: e.target.value })}
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={closeModal} className="btn-secondary" disabled={submitting}>
                Cancel
              </button>
              <button
                onClick={save}
                className="btn-primary"
                disabled={submitting || (resultingStock != null && resultingStock < 0)}
              >
                {submitting ? "Recording..." : "Record Movement"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
