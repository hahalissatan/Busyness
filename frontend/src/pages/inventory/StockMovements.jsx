/**
 * StockMovements — record and view stock movements.
 */

import { useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { DataTable } from "../../components/ui/DataTable.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { Plus } from "../../components/icons.jsx";

const MOVEMENT_TYPES = ["purchase", "return", "sale", "writeoff", "adjustment", "transfer"];

export default function StockMovements() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/inventory`;
  const [modal, setModal] = useState(false);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ product_id: "", movement_type: "purchase", quantity: "", unit_cost: "", reason: "" });
  const [formError, setFormError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const openCreate = async () => {
    try { const res = await api.list(`${base}/products`, { limit: 100 }); setProducts(res.data); } catch {}
    setModal(true);
  };

  const save = async () => {
    setFormError(null);
    if (!form.product_id || !form.quantity) { setFormError("Product and quantity are required."); return; }
    try {
      await api.post(`${base}/stock-movements`, {
        product_id: form.product_id,
        movement_type: form.movement_type,
        quantity: parseFloat(form.quantity),
        unit_cost: form.unit_cost ? parseFloat(form.unit_cost) : undefined,
        reason: form.reason || undefined,
      });
      setModal(false);
      setForm({ product_id: "", movement_type: "purchase", quantity: "", unit_cost: "", reason: "" });
      setRefreshKey((k) => k + 1);
    } catch (err) { setFormError(err.message); }
  };

  const typeColor = (t) => ({ purchase: "green", return: "green", sale: "yellow", writeoff: "red", adjustment: "blue", transfer: "blue" }[t] || "gray");

  return (
    <div className="space-y-4">
      <DataTable
        key={refreshKey}
        columns={[
          { key: "product_name", label: "Product", render: (r) => <span className="font-medium">{r.product_name || "—"}</span> },
          { key: "movement_type", label: "Type", render: (r) => <Badge color={typeColor(r.movement_type)}>{r.movement_type}</Badge> },
          { key: "quantity", label: "Quantity", render: (r) => (r.movement_type === "sale" || r.movement_type === "writeoff" ? `−${r.quantity}` : `+${r.quantity}`) },
          { key: "unit_cost", label: "Unit Cost", render: (r) => r.unit_cost ? `RM ${parseFloat(r.unit_cost).toFixed(2)}` : "—" },
          { key: "reason", label: "Reason", render: (r) => r.reason || "—" },
          { key: "created_at", label: "Date", render: (r) => new Date(r.created_at).toLocaleString() },
        ]}
        fetchData={(params) => api.list(`${base}/stock-movements`, params)}
        searchPlaceholder="Search movements..."
        emptyTitle="No stock movements yet"
        emptyMessage="Record stock in/out to track your inventory changes."
        emptyIcon="📦"
        actions={{ create: <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> Record Movement</button> }}
      />

      {modal && (
        <Modal open onClose={() => setModal(false)} title="Record Stock Movement">
          <div className="space-y-4">
            {formError && <div className="p-3 rounded-lg bg-red-50 text-red-800 text-sm">{formError}</div>}
            <div><label className="label">Product</label><select className="input" value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}><option value="">Select product...</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} (Stock: {p.stock_quantity})</option>)}</select></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Movement Type</label><select className="input" value={form.movement_type} onChange={(e) => setForm({ ...form, movement_type: e.target.value })}>{MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
              <div><label className="label">Quantity</label><input type="number" step="0.01" min="0" className="input" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Unit Cost (optional)</label><input type="number" step="0.01" min="0" className="input" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} /></div>
              <div><label className="label">Reason (optional)</label><input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
            </div>
            <div className="flex gap-2 justify-end"><button onClick={() => setModal(false)} className="btn-secondary">Cancel</button><button onClick={save} className="btn-primary">Record</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
