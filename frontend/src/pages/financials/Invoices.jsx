/**
 * Invoices — list invoices with status filter, create with line items.
 *
 * Audit fixes applied:
 * - Line item field "product_name" → "description" (matches Zod schema)
 * - Line item field "discount" → "discount_amount" (matches Zod schema)
 * - Added required "invoice_number" field (Zod requires min 1 char)
 * - Added "sort_order" field (auto-incremented by item index)
 * - Fixed table columns: removed customer_name & paid_amount (not in API response),
 *   added invoice_number, and fetch customer names via lookup
 * - Added status filter dropdown (backend supports ?status= filter)
 * - Removed text search (backend doesn't support ?search= for invoices)
 * - Added submitting state + field-level error display
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { DataTable } from "../../components/ui/DataTable.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { Plus, Trash } from "../../components/icons.jsx";

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "unpaid", label: "Unpaid" },
  { value: "partially_paid", label: "Partially Paid" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

const emptyItem = () => ({
  description: "",
  quantity: 1,
  unit_price: 0,
  tax_rate: 0,
  discount_amount: 0,
});

export default function Invoices() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/financials`;
  const navigate = useNavigate();
  const [createModal, setCreateModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [customerMap, setCustomerMap] = useState({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const [form, setForm] = useState({
    customer_id: "",
    invoice_number: "",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: "",
    notes: "",
    items: [emptyItem()],
  });

  // Fetch customers for name lookup in table + create modal
  useEffect(() => {
    (async () => {
      try {
        const res = await api.list(`${base}/customers`, { limit: 100 });
        const map = {};
        for (const c of res.data) {
          map[c.id] = c.name;
        }
        setCustomerMap(map);
      } catch {
        // non-critical — table will show "—" for unknown customers
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id]);

  const openCreate = () => {
    setFormError(null);
    setFieldErrors({});
    setForm({
      customer_id: "",
      invoice_number: `INV-${Date.now().toString().slice(-6)}`,
      issue_date: new Date().toISOString().slice(0, 10),
      due_date: "",
      notes: "",
      items: [emptyItem()],
    });
    setCreateModal(true);
  };

  const closeModal = () => {
    if (saving) return;
    setCreateModal(false);
    setFormError(null);
    setFieldErrors({});
  };

  const addItem = () => setForm({ ...form, items: [...form.items, emptyItem()] });
  const removeItem = (idx) => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
  const updateItem = (idx, field, val) => {
    const items = [...form.items];
    items[idx] = { ...items[idx], [field]: field === "description" ? val : parseFloat(val) || 0 };
    setForm({ ...form, items });
  };

  const createInvoice = async () => {
    setFormError(null);
    setFieldErrors({});
    if (!form.customer_id || !form.due_date) {
      setFormError("Customer and due date are required.");
      return;
    }
    if (!form.invoice_number.trim()) {
      setFormError("Invoice number is required.");
      return;
    }
    if (form.items.length === 0) {
      setFormError("At least one line item is required.");
      return;
    }
    // Check all items have descriptions
    const missingDesc = form.items.some((it) => !it.description.trim());
    if (missingDesc) {
      setFormError("All line items must have a description.");
      return;
    }

    setSaving(true);
    try {
      // Build payload with correct field names + sort_order
      const payload = {
        customer_id: form.customer_id,
        invoice_number: form.invoice_number.trim(),
        issue_date: form.issue_date,
        due_date: form.due_date,
        notes: form.notes || null,
        items: form.items.map((item, idx) => ({
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          tax_rate: item.tax_rate,
          discount_amount: item.discount_amount,
          sort_order: idx,
        })),
      };
      const res = await api.post(`${base}/invoices`, payload);
      closeModal();
      navigate(`/financial/invoices/${res.invoice.id}`);
    } catch (err) {
      if (err.details?.errors) {
        const fe = {};
        for (const e of err.details.errors) {
          fe[e.field] = e.message;
        }
        setFieldErrors(fe);
      }
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status filter bar */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-500">Filter:</label>
        <select
          className="input max-w-[180px] py-2"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setRefreshKey((k) => k + 1); }}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <DataTable
        key={`${refreshKey}-${statusFilter}`}
        columns={[
          {
            key: "invoice_number", label: "Invoice #",
            render: (row) => <span className="font-medium">{row.invoice_number}</span>,
          },
          {
            key: "customer_id", label: "Customer",
            render: (row) => customerMap[row.customer_id] || "—",
          },
          { key: "status", label: "Status", render: (row) => <Badge status={row.status} /> },
          { key: "total", label: "Total", render: (row) => `RM ${(parseFloat(row.total) || 0).toFixed(2)}` },
          { key: "issue_date", label: "Issued", render: (row) => new Date(row.issue_date).toLocaleDateString() },
          { key: "due_date", label: "Due", render: (row) => new Date(row.due_date).toLocaleDateString() },
        ]}
        fetchData={(params) => {
          const finalParams = { page: params.page, limit: params.limit };
          if (statusFilter) finalParams.status = statusFilter;
          // Backend doesn't support text search for invoices — only status filter
          return api.list(`${base}/invoices`, finalParams);
        }}
        onRowClick={(row) => navigate(`/financial/invoices/${row.id}`)}
        searchPlaceholder="Use status filter above..."
        emptyTitle="No invoices yet"
        emptyMessage="Create your first invoice to start tracking payments."
        emptyIcon="📄"
        actions={{ create: <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> New Invoice</button> }}
      />

      {createModal && (
        <Modal open onClose={closeModal} title="New Invoice" size="xl">
          <div className="space-y-4">
            {formError && (
              <div className="p-3 rounded-lg bg-red-50 text-red-800 text-sm">
                {formError}
                {Object.keys(fieldErrors).length > 0 && (
                  <ul className="mt-1 list-disc list-inside text-xs">
                    {Object.entries(fieldErrors).map(([f, m]) => (
                      <li key={f}>{f}: {m}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Customer</label>
                <select className="input" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
                  <option value="">Select customer...</option>
                  {Object.entries(customerMap).map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Invoice Number</label>
                <input className="input" value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} placeholder="INV-001" />
              </div>
              <div>
                <label className="label">Issue Date</label>
                <input type="date" className="input" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} />
              </div>
              <div>
                <label className="label">Due Date</label>
                <input type="date" className="input" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
              </div>
            </div>

            <div>
              <label className="label">Notes (optional)</label>
              <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label">Line Items</label>
                <button onClick={addItem} className="btn-secondary !py-1"><Plus className="w-3 h-3" /> Add</button>
              </div>
              <div className="space-y-2">
                {form.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input
                      className="input col-span-4"
                      placeholder="Description"
                      value={item.description}
                      onChange={(e) => updateItem(idx, "description", e.target.value)}
                    />
                    <input
                      className="input col-span-2"
                      type="number" min="0" step="1"
                      placeholder="Qty"
                      value={item.quantity}
                      onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                    />
                    <input
                      className="input col-span-2"
                      type="number" min="0" step="0.01"
                      placeholder="Price"
                      value={item.unit_price}
                      onChange={(e) => updateItem(idx, "unit_price", e.target.value)}
                    />
                    <input
                      className="input col-span-1"
                      type="number" min="0" max="100" step="0.01"
                      placeholder="Tax%"
                      value={item.tax_rate}
                      onChange={(e) => updateItem(idx, "tax_rate", e.target.value)}
                    />
                    <input
                      className="input col-span-2"
                      type="number" min="0" step="0.01"
                      placeholder="Disc"
                      value={item.discount_amount}
                      onChange={(e) => updateItem(idx, "discount_amount", e.target.value)}
                    />
                    <button onClick={() => removeItem(idx)} className="col-span-1 text-red-600 hover:text-red-800">
                      <Trash className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={closeModal} className="btn-secondary" disabled={saving}>Cancel</button>
              <button onClick={createInvoice} className="btn-primary" disabled={saving}>
                {saving ? "Creating..." : "Create Invoice"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
