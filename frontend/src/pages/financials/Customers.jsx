/**
 * Customers — CRUD for financial hub customers.
 *
 * Audit fixes applied:
 * - Added try/catch in save() with field-level error display
 * - Added submitting state on Save button (prevents duplicate submissions)
 * - Parse backend validation errors (error.details.errors[])
 */

import { useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { DataTable } from "../../components/ui/DataTable.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { Plus } from "../../components/icons.jsx";

export default function Customers() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/financials`;
  const [modal, setModal] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const openCreate = () => {
    setFormError(null);
    setFieldErrors({});
    setModal({ mode: "create", data: { name: "", email: "", phone: "", address: "" } });
  };
  const openEdit = (row) => {
    setFormError(null);
    setFieldErrors({});
    setModal({ mode: "edit", data: { ...row } });
  };
  const closeModal = () => {
    if (saving) return; // prevent closing during submit
    setModal(null);
    setFormError(null);
    setFieldErrors({});
  };

  const updateField = (field, value) => {
    setModal({ ...modal, data: { ...modal.data, [field]: value } });
    // Clear field error on change
    if (fieldErrors[field]) {
      setFieldErrors({ ...fieldErrors, [field]: undefined });
    }
  };

  const save = async () => {
    setFormError(null);
    setFieldErrors({});
    setSaving(true);
    try {
      const { id, ...body } = modal.data;
      if (modal.mode === "create") {
        await api.post(`${base}/customers`, body);
      } else {
        await api.patch(`${base}/customers/${id}`, body);
      }
      closeModal();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      // Parse field-level validation errors from backend
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
      <DataTable
        key={refreshKey}
        columns={[
          { key: "name", label: "Name" },
          { key: "email", label: "Email" },
          { key: "phone", label: "Phone" },
          {
            key: "created_at", label: "Created",
            render: (row) => new Date(row.created_at).toLocaleDateString(),
          },
        ]}
        fetchData={(params) => api.list(`${base}/customers`, params)}
        searchPlaceholder="Search customers..."
        emptyTitle="No customers yet"
        emptyMessage="Create your first customer to start invoicing."
        emptyIcon="👤"
        actions={{
          create: <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> New Customer</button>,
          edit: openEdit,
        }}
      />

      {modal && (
        <Modal
          open
          onClose={closeModal}
          title={modal.mode === "create" ? "New Customer" : "Edit Customer"}
        >
          <div className="space-y-4">
            {formError && !fieldErrors.name && !fieldErrors.email && !fieldErrors.phone && !fieldErrors.address && (
              <div className="p-3 rounded-lg bg-red-50 text-red-800 text-sm">{formError}</div>
            )}
            {formError && (fieldErrors.name || fieldErrors.email || fieldErrors.phone || fieldErrors.address) && (
              <div className="p-3 rounded-lg bg-red-50 text-red-800 text-sm">Please fix the highlighted fields below.</div>
            )}
            <div>
              <label className="label">Name</label>
              <input className="input" value={modal.data.name} onChange={(e) => updateField("name", e.target.value)} />
              {fieldErrors.name && <p className="text-xs text-red-600 mt-1">{fieldErrors.name}</p>}
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" value={modal.data.email || ""} onChange={(e) => updateField("email", e.target.value)} />
              {fieldErrors.email && <p className="text-xs text-red-600 mt-1">{fieldErrors.email}</p>}
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={modal.data.phone || ""} onChange={(e) => updateField("phone", e.target.value)} />
              {fieldErrors.phone && <p className="text-xs text-red-600 mt-1">{fieldErrors.phone}</p>}
            </div>
            <div>
              <label className="label">Address</label>
              <textarea className="input" rows={2} value={modal.data.address || ""} onChange={(e) => updateField("address", e.target.value)} />
              {fieldErrors.address && <p className="text-xs text-red-600 mt-1">{fieldErrors.address}</p>}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={closeModal} className="btn-secondary" disabled={saving}>Cancel</button>
              <button onClick={save} className="btn-primary" disabled={saving}>
                {saving ? "Saving..." : modal.mode === "create" ? "Create" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
