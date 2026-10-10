/**
 * Products — product management with stock info and create/update.
 *
 * Backend contract (routes/inventory.js):
 *   POST   /products                    — Create product
 *   GET    /products                    — List (search + active filter)
 *   GET    /products/:id                — Get single (with supplier info)
 *   PATCH  /products/:id                — Update (NOT stock_quantity — protected)
 *   POST   /products/:id/deactivate     — Deactivate (soft delete)
 *
 * Product fields: name, sku, description, min_stock_threshold, unit_cost,
 *                 expiry_date, supplier_id, is_active
 * stock_quantity is read-only (protected by DB trigger).
 */

import { useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { DataTable } from "../../components/ui/DataTable.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { Plus } from "../../components/icons.jsx";

const EMPTY_FORM = {
  name: "",
  sku: "",
  description: "",
  unit_cost: "",
  min_stock_threshold: "0",
  expiry_date: "",
  supplier_id: "",
};

export default function Products() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/inventory`;
  const [modal, setModal] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeFilter, setActiveFilter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);

  const openCreate = async () => {
    setFieldErrors({});
    setFormError(null);
    try {
      const res = await api.list(`${base}/suppliers`, { limit: 100 });
      setSuppliers(res.data || []);
    } catch {
      setSuppliers([]);
    }
    setModal({ mode: "create", data: { ...EMPTY_FORM } });
  };

  const openEdit = async (row) => {
    setFieldErrors({});
    setFormError(null);
    try {
      const res = await api.list(`${base}/suppliers`, { limit: 100 });
      setSuppliers(res.data || []);
    } catch {
      setSuppliers([]);
    }
    setModal({
      mode: "edit",
      data: {
        id: row.id,
        name: row.name || "",
        sku: row.sku || "",
        description: row.description || "",
        unit_cost: row.unit_cost != null ? String(row.unit_cost) : "",
        min_stock_threshold:
          row.min_stock_threshold != null ? String(row.min_stock_threshold) : "0",
        expiry_date: row.expiry_date || "",
        supplier_id: row.supplier_id || "",
      },
    });
  };

  const closeModal = () => {
    setModal(null);
    setFieldErrors({});
    setFormError(null);
  };

  const save = async () => {
    if (submitting) return;
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);

    const { id, stock_quantity, business_id, created_at, updated_at, supplier_name, ...rest } =
      modal.data;

    const payload = {};
    // name
    payload.name = rest.name;
    // sku
    payload.sku = rest.sku;
    // description
    if (rest.description) payload.description = rest.description;
    else payload.description = null;
    // unit_cost
    if (rest.unit_cost !== "" && rest.unit_cost != null)
      payload.unit_cost = parseFloat(rest.unit_cost);
    else payload.unit_cost = 0;
    // min_stock_threshold
    if (rest.min_stock_threshold !== "" && rest.min_stock_threshold != null)
      payload.min_stock_threshold = parseFloat(rest.min_stock_threshold);
    else payload.min_stock_threshold = 0;
    // expiry_date
    if (rest.expiry_date) payload.expiry_date = rest.expiry_date;
    else payload.expiry_date = null;
    // supplier_id
    if (rest.supplier_id) payload.supplier_id = rest.supplier_id;
    else payload.supplier_id = null;

    try {
      if (modal.mode === "create") {
        await api.post(`${base}/products`, payload);
      } else {
        await api.patch(`${base}/products/${id}`, payload);
      }
      closeModal();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      if (err.details?.errors) {
        const fe = {};
        for (const e of err.details.errors) {
          fe[e.field] = e.message;
        }
        setFieldErrors(fe);
      }
      setFormError(err.message || "Failed to save product.");
    } finally {
      setSubmitting(false);
    }
  };

  const deactivate = async (row) => {
    if (!confirm(`Deactivate "${row.name}"? This will mark the product as inactive.`)) return;
    try {
      await api.post(`${base}/products/${row.id}/deactivate`, {});
      setRefreshKey((k) => k + 1);
    } catch (err) {
      alert(err.message || "Failed to deactivate product.");
    }
  };

  const handleFilterChange = (v) => {
    setActiveFilter(v);
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="space-y-4">
      {/* Active filter */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-500">Filter:</label>
        <select
          className="input !py-1.5 !w-auto"
          value={activeFilter}
          onChange={(e) => handleFilterChange(e.target.value)}
        >
          <option value="">All products</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </select>
      </div>

      <DataTable
        key={refreshKey}
        columns={[
          { key: "name", label: "Product", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "sku", label: "SKU" },
          {
            key: "stock_quantity",
            label: "Stock",
            render: (r) => (
              <span
                className={
                  parseFloat(r.stock_quantity) <= parseFloat(r.min_stock_threshold)
                    ? "text-red-600 font-bold"
                    : ""
                }
              >
                {r.stock_quantity}
              </span>
            ),
          },
          {
            key: "unit_cost",
            label: "Unit Cost",
            render: (r) => (r.unit_cost != null ? `RM ${parseFloat(r.unit_cost).toFixed(2)}` : "—"),
          },
          {
            key: "supplier_name",
            label: "Supplier",
            render: (r) => r.supplier_name || "—",
          },
          {
            key: "is_active",
            label: "Status",
            render: (r) => (
              <Badge color={r.is_active ? "green" : "gray"}>
                {r.is_active ? "Active" : "Inactive"}
              </Badge>
            ),
          },
        ]}
        fetchData={(params) => {
          const finalParams = { ...params };
          if (activeFilter) finalParams.active = activeFilter;
          return api.list(`${base}/products`, finalParams);
        }}
        searchPlaceholder="Search products..."
        emptyTitle="No products yet"
        emptyMessage="Add your first product to start tracking inventory."
        emptyIcon="📦"
        actions={{
          create: (
            <button onClick={openCreate} className="btn-primary">
              <Plus className="w-4 h-4" /> New Product
            </button>
          ),
          edit: openEdit,
          custom: (row) =>
            row.is_active && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deactivate(row);
                }}
                className="text-yellow-600 hover:text-yellow-800 p-1"
              >
                Deactivate
              </button>
            ),
        }}
      />

      {modal && (
        <Modal
          open
          onClose={closeModal}
          title={modal.mode === "create" ? "New Product" : "Edit Product"}
        >
          <div className="space-y-4">
            {formError && (
              <div className="p-3 rounded-lg bg-red-50 text-red-800 text-sm">{formError}</div>
            )}

            <div>
              <label className="label">Name</label>
              <input
                className="input"
                value={modal.data.name}
                onChange={(e) => setModal({ ...modal, data: { ...modal.data, name: e.target.value } })}
              />
              {fieldErrors.name && (
                <p className="text-xs text-red-600 mt-1">{fieldErrors.name}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">SKU</label>
                <input
                  className="input"
                  value={modal.data.sku || ""}
                  onChange={(e) =>
                    setModal({ ...modal, data: { ...modal.data, sku: e.target.value } })
                  }
                />
                {fieldErrors.sku && <p className="text-xs text-red-600 mt-1">{fieldErrors.sku}</p>}
              </div>
              <div>
                <label className="label">Supplier</label>
                <select
                  className="input"
                  value={modal.data.supplier_id || ""}
                  onChange={(e) =>
                    setModal({ ...modal, data: { ...modal.data, supplier_id: e.target.value } })
                  }
                >
                  <option value="">None</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {fieldErrors.supplier_id && (
                  <p className="text-xs text-red-600 mt-1">{fieldErrors.supplier_id}</p>
                )}
              </div>
            </div>

            <div>
              <label className="label">Description</label>
              <textarea
                className="input"
                rows={2}
                value={modal.data.description || ""}
                onChange={(e) =>
                  setModal({ ...modal, data: { ...modal.data, description: e.target.value } })
                }
              />
              {fieldErrors.description && (
                <p className="text-xs text-red-600 mt-1">{fieldErrors.description}</p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Unit Cost (RM)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  value={modal.data.unit_cost || ""}
                  onChange={(e) =>
                    setModal({ ...modal, data: { ...modal.data, unit_cost: e.target.value } })
                  }
                />
                {fieldErrors.unit_cost && (
                  <p className="text-xs text-red-600 mt-1">{fieldErrors.unit_cost}</p>
                )}
              </div>
              <div>
                <label className="label">Min Stock Threshold</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  className="input"
                  value={modal.data.min_stock_threshold || ""}
                  onChange={(e) =>
                    setModal({
                      ...modal,
                      data: { ...modal.data, min_stock_threshold: e.target.value },
                    })
                  }
                />
                {fieldErrors.min_stock_threshold && (
                  <p className="text-xs text-red-600 mt-1">{fieldErrors.min_stock_threshold}</p>
                )}
              </div>
              <div>
                <label className="label">Expiry Date</label>
                <input
                  type="date"
                  className="input"
                  value={modal.data.expiry_date || ""}
                  onChange={(e) =>
                    setModal({ ...modal, data: { ...modal.data, expiry_date: e.target.value } })
                  }
                />
                {fieldErrors.expiry_date && (
                  <p className="text-xs text-red-600 mt-1">{fieldErrors.expiry_date}</p>
                )}
              </div>
            </div>

            {modal.mode === "edit" && (
              <div className="p-3 rounded-lg bg-blue-50 text-blue-800 text-sm">
                Stock quantity is managed through stock movements and cannot be edited directly here.
                Current stock: <strong>{modal.data.stock_quantity ?? "—"}</strong>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button onClick={closeModal} className="btn-secondary" disabled={submitting}>
                Cancel
              </button>
              <button onClick={save} className="btn-primary" disabled={submitting}>
                {submitting ? "Saving..." : modal.mode === "create" ? "Create" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
