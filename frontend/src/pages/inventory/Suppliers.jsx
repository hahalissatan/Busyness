/**
 * Suppliers — supplier CRUD.
 *
 * Backend contract (routes/inventory.js):
 *   POST   /suppliers              — Create supplier
 *   GET    /suppliers              — List (pagination + search)
 *   GET    /suppliers/:id          — Get single supplier
 *   PATCH  /suppliers/:id          — Update supplier
 *
 * Supplier fields: name, contact_name, email, phone, address
 */

import { useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { DataTable } from "../../components/ui/DataTable.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { Plus } from "../../components/icons.jsx";

const EMPTY_FORM = {
  name: "",
  contact_name: "",
  email: "",
  phone: "",
  address: "",
};

export default function Suppliers() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/inventory`;
  const [modal, setModal] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);

  const openCreate = () => {
    setFieldErrors({});
    setFormError(null);
    setModal({ mode: "create", data: { ...EMPTY_FORM } });
  };

  const openEdit = (row) => {
    setFieldErrors({});
    setFormError(null);
    setModal({
      mode: "edit",
      data: {
        id: row.id,
        name: row.name || "",
        contact_name: row.contact_name || "",
        email: row.email || "",
        phone: row.phone || "",
        address: row.address || "",
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

    const { id, business_id, created_at, updated_at, ...rest } = modal.data;

    const payload = {
      name: rest.name,
      contact_name: rest.contact_name || null,
      email: rest.email || null,
      phone: rest.phone || null,
      address: rest.address || null,
    };

    try {
      if (modal.mode === "create") {
        await api.post(`${base}/suppliers`, payload);
      } else {
        await api.patch(`${base}/suppliers/${id}`, payload);
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
      setFormError(err.message || "Failed to save supplier.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <DataTable
        key={refreshKey}
        columns={[
          { key: "name", label: "Supplier", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "contact_name", label: "Contact", render: (r) => r.contact_name || "—" },
          { key: "email", label: "Email", render: (r) => r.email || "—" },
          { key: "phone", label: "Phone", render: (r) => r.phone || "—" },
        ]}
        fetchData={(params) => api.list(`${base}/suppliers`, params)}
        searchPlaceholder="Search suppliers..."
        emptyTitle="No suppliers yet"
        emptyMessage="Add suppliers to link them to your products."
        emptyIcon="🚚"
        actions={{
          create: (
            <button onClick={openCreate} className="btn-primary">
              <Plus className="w-4 h-4" /> New Supplier
            </button>
          ),
          edit: openEdit,
        }}
      />

      {modal && (
        <Modal
          open
          onClose={closeModal}
          title={modal.mode === "create" ? "New Supplier" : "Edit Supplier"}
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

            <div>
              <label className="label">Contact Name</label>
              <input
                className="input"
                value={modal.data.contact_name || ""}
                onChange={(e) =>
                  setModal({ ...modal, data: { ...modal.data, contact_name: e.target.value } })
                }
              />
              {fieldErrors.contact_name && (
                <p className="text-xs text-red-600 mt-1">{fieldErrors.contact_name}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  className="input"
                  value={modal.data.email || ""}
                  onChange={(e) =>
                    setModal({ ...modal, data: { ...modal.data, email: e.target.value } })
                  }
                />
                {fieldErrors.email && (
                  <p className="text-xs text-red-600 mt-1">{fieldErrors.email}</p>
                )}
              </div>
              <div>
                <label className="label">Phone</label>
                <input
                  className="input"
                  value={modal.data.phone || ""}
                  onChange={(e) =>
                    setModal({ ...modal, data: { ...modal.data, phone: e.target.value } })
                  }
                />
                {fieldErrors.phone && (
                  <p className="text-xs text-red-600 mt-1">{fieldErrors.phone}</p>
                )}
              </div>
            </div>

            <div>
              <label className="label">Address</label>
              <textarea
                className="input"
                rows={2}
                value={modal.data.address || ""}
                onChange={(e) =>
                  setModal({ ...modal, data: { ...modal.data, address: e.target.value } })
                }
              />
              {fieldErrors.address && (
                <p className="text-xs text-red-600 mt-1">{fieldErrors.address}</p>
              )}
            </div>

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
