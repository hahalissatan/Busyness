/**
 * Products — product management with stock info and create/update.
 */

import { useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { DataTable } from "../../components/ui/DataTable.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { Plus } from "../../components/icons.jsx";

export default function Products() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/inventory`;
  const [modal, setModal] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const openCreate = async () => {
    try { const res = await api.list(`${base}/suppliers`, { limit: 100 }); setSuppliers(res.data); } catch {}
    setModal({ mode: "create", data: { name: "", sku: "", description: "", unit_price: "", cost_price: "", reorder_threshold: "5", supplier_id: "" } });
  };
  const openEdit = (row) => setModal({ mode: "edit", data: { ...row } });
  const closeModal = () => setModal(null);

  const save = async () => {
    const { id, stock_quantity, business_id, created_at, updated_at, supplier_name, ...body } = modal.data;
    const payload = { ...body };
    if (payload.unit_price) payload.unit_price = parseFloat(payload.unit_price);
    if (payload.cost_price) payload.cost_price = parseFloat(payload.cost_price);
    if (payload.reorder_threshold) payload.reorder_threshold = parseFloat(payload.reorder_threshold);
    if (!payload.supplier_id) delete payload.supplier_id;

    if (modal.mode === "create") await api.post(`${base}/products`, payload);
    else await api.patch(`${base}/products/${id}`, payload);
    closeModal();
    setRefreshKey((k) => k + 1);
  };

  const deactivate = async (row) => {
    if (!confirm(`Deactivate "${row.name}"?`)) return;
    await api.post(`${base}/products/${row.id}/deactivate`, {});
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="space-y-4">
      <DataTable
        key={refreshKey}
        columns={[
          { key: "name", label: "Product", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "sku", label: "SKU" },
          { key: "stock_quantity", label: "Stock", render: (r) => <span className={parseFloat(r.stock_quantity) <= parseFloat(r.reorder_threshold) ? "text-red-600 font-bold" : ""}>{r.stock_quantity}</span> },
          { key: "unit_price", label: "Price", render: (r) => `RM ${parseFloat(r.unit_price).toFixed(2)}` },
          { key: "supplier_name", label: "Supplier", render: (r) => r.supplier_name || "—" },
          { key: "is_active", label: "Status", render: (r) => <Badge color={r.is_active ? "green" : "gray"}>{r.is_active ? "Active" : "Inactive"}</Badge> },
        ]}
        fetchData={(params) => api.list(`${base}/products`, params)}
        searchPlaceholder="Search products..."
        emptyTitle="No products yet"
        emptyMessage="Add your first product to start tracking inventory."
        emptyIcon="📦"
        actions={{
          create: <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> New Product</button>,
          edit: openEdit,
          custom: (row) => row.is_active && <button onClick={(e) => { e.stopPropagation(); deactivate(row); }} className="text-yellow-600 hover:text-yellow-800 p-1">Deactivate</button>,
        }}
      />

      {modal && (
        <Modal open onClose={closeModal} title={modal.mode === "create" ? "New Product" : "Edit Product"}>
          <div className="space-y-4">
            <div><label className="label">Name</label><input className="input" value={modal.data.name} onChange={(e) => setModal({ ...modal, data: { ...modal.data, name: e.target.value } })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">SKU</label><input className="input" value={modal.data.sku || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, sku: e.target.value } })} /></div>
              <div><label className="label">Supplier</label><select className="input" value={modal.data.supplier_id || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, supplier_id: e.target.value } })}><option value="">None</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            </div>
            <div><label className="label">Description</label><textarea className="input" rows={2} value={modal.data.description || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, description: e.target.value } })} /></div>
            <div className="grid grid-cols-3 gap-4">
              <div><label className="label">Unit Price</label><input type="number" step="0.01" className="input" value={modal.data.unit_price || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, unit_price: e.target.value } })} /></div>
              <div><label className="label">Cost Price</label><input type="number" step="0.01" className="input" value={modal.data.cost_price || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, cost_price: e.target.value } })} /></div>
              <div><label className="label">Reorder At</label><input type="number" step="1" className="input" value={modal.data.reorder_threshold || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, reorder_threshold: e.target.value } })} /></div>
            </div>
            <div className="flex gap-2 justify-end"><button onClick={closeModal} className="btn-secondary">Cancel</button><button onClick={save} className="btn-primary">{modal.mode === "create" ? "Create" : "Save"}</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
