/**
 * Customers — CRUD for financial hub customers.
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

  const openCreate = () => setModal({ mode: "create", data: { name: "", email: "", phone: "", address: "" } });
  const openEdit = (row) => setModal({ mode: "edit", data: { ...row } });
  const closeModal = () => setModal(null);

  const save = async () => {
    const { id, ...body } = modal.data;
    if (modal.mode === "create") {
      await api.post(`${base}/customers`, body);
    } else {
      await api.patch(`${base}/customers/${id}`, body);
    }
    closeModal();
    setRefreshKey((k) => k + 1);
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
            <div><label className="label">Name</label><input className="input" value={modal.data.name} onChange={(e) => setModal({ ...modal, data: { ...modal.data, name: e.target.value } })} /></div>
            <div><label className="label">Email</label><input className="input" value={modal.data.email || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, email: e.target.value } })} /></div>
            <div><label className="label">Phone</label><input className="input" value={modal.data.phone || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, phone: e.target.value } })} /></div>
            <div><label className="label">Address</label><textarea className="input" rows={2} value={modal.data.address || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, address: e.target.value } })} /></div>
            <div className="flex gap-2 justify-end">
              <button onClick={closeModal} className="btn-secondary">Cancel</button>
              <button onClick={save} className="btn-primary">{modal.mode === "create" ? "Create" : "Save"}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
