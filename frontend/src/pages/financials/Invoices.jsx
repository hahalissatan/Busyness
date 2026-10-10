/**
 * Invoices — list invoices with status filter, create with line items.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { DataTable } from "../../components/ui/DataTable.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { Plus, Trash } from "../../components/icons.jsx";

export default function Invoices() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/financials`;
  const navigate = useNavigate();
  const [createModal, setCreateModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [form, setForm] = useState({
    customer_id: "",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: "",
    items: [{ product_name: "", quantity: 1, unit_price: 0, tax_rate: 0, discount: 0 }],
  });

  const [customers, setCustomers] = useState([]);
  const [formError, setFormError] = useState(null);

  const openCreate = async () => {
    try {
      const res = await api.list(`${base}/customers`, { limit: 100 });
      setCustomers(res.data);
    } catch {}
    setCreateModal(true);
  };

  const addItem = () => setForm({ ...form, items: [...form.items, { product_name: "", quantity: 1, unit_price: 0, tax_rate: 0, discount: 0 }] });
  const removeItem = (idx) => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
  const updateItem = (idx, field, val) => {
    const items = [...form.items];
    items[idx] = { ...items[idx], [field]: field === "product_name" ? val : parseFloat(val) || 0 };
    setForm({ ...form, items });
  };

  const createInvoice = async () => {
    setFormError(null);
    if (!form.customer_id || !form.due_date) {
      setFormError("Customer and due date are required.");
      return;
    }
    if (form.items.length === 0) {
      setFormError("At least one line item is required.");
      return;
    }
    try {
      const res = await api.post(`${base}/invoices`, form);
      setCreateModal(false);
      setForm({ customer_id: "", issue_date: new Date().toISOString().slice(0, 10), due_date: "", items: [{ product_name: "", quantity: 1, unit_price: 0, tax_rate: 0, discount: 0 }] });
      navigate(`/financials/invoices/${res.id}`);
    } catch (err) {
      setFormError(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <DataTable
        key={refreshKey}
        columns={[
          {
            key: "customer_name", label: "Customer",
            render: (row) => <span className="font-medium">{row.customer_name || "—"}</span>,
          },
          { key: "status", label: "Status", render: (row) => <Badge status={row.status} /> },
          { key: "total", label: "Total", render: (row) => `RM ${(parseFloat(row.total) || 0).toFixed(2)}` },
          { key: "paid_amount", label: "Paid", render: (row) => `RM ${(parseFloat(row.paid_amount) || 0).toFixed(2)}` },
          { key: "issue_date", label: "Issued", render: (row) => new Date(row.issue_date).toLocaleDateString() },
          { key: "due_date", label: "Due", render: (row) => new Date(row.due_date).toLocaleDateString() },
        ]}
        fetchData={(params) => api.list(`${base}/invoices`, params)}
        onRowClick={(row) => navigate(`/financials/invoices/${row.id}`)}
        searchPlaceholder="Search invoices..."
        emptyTitle="No invoices yet"
        emptyMessage="Create your first invoice to start tracking payments."
        emptyIcon="📄"
        actions={{ create: <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> New Invoice</button> }}
      />

      {createModal && (
        <Modal open onClose={() => setCreateModal(false)} title="New Invoice" size="lg">
          <div className="space-y-4">
            {formError && <div className="p-3 rounded-lg bg-red-50 text-red-800 text-sm">{formError}</div>}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Customer</label>
                <select className="input" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
                  <option value="">Select customer...</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div><label className="label">Issue Date</label><input type="date" className="input" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} /></div>
              <div><label className="label">Due Date</label><input type="date" className="input" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label">Line Items</label>
                <button onClick={addItem} className="btn-secondary !py-1"><Plus className="w-3 h-3" /> Add</button>
              </div>
              <div className="space-y-2">
                {form.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input className="input col-span-4" placeholder="Product name" value={item.product_name} onChange={(e) => updateItem(idx, "product_name", e.target.value)} />
                    <input className="input col-span-2" type="number" min="0" step="1" placeholder="Qty" value={item.quantity} onChange={(e) => updateItem(idx, "quantity", e.target.value)} />
                    <input className="input col-span-2" type="number" min="0" step="0.01" placeholder="Price" value={item.unit_price} onChange={(e) => updateItem(idx, "unit_price", e.target.value)} />
                    <input className="input col-span-1" type="number" min="0" step="0.01" placeholder="Tax%" value={item.tax_rate} onChange={(e) => updateItem(idx, "tax_rate", e.target.value)} />
                    <input className="input col-span-2" type="number" min="0" step="0.01" placeholder="Disc" value={item.discount} onChange={(e) => updateItem(idx, "discount", e.target.value)} />
                    <button onClick={() => removeItem(idx)} className="col-span-1 text-red-600 hover:text-red-800"><Trash className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setCreateModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={createInvoice} className="btn-primary">Create Invoice</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
