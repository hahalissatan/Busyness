/**
 * Suppliers — supplier CRUD.
 */

import { useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { DataTable } from "../../components/ui/DataTable.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { Plus } from "../../components/icons.jsx";

export default function Suppliers() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/inventory`;
  const [modal, setModal] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const openCreate = () => setModal({ mode: "create", data: { name: "", email: "", phone: "", address: "" } });
  const openEdit = (row) => setModal({ mode: "edit", data: { ...row } });
  const closeModal = () => setModal(null);

  const save = async () => {
    const { id, business_id, created_at, ...body } = modal.data;
    if (modal.mode === "create") await api.post(`${base}/suppliers`, body);
    else await api.patch(`${base}/suppliers/${id}`, body);
    closeModal();
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="space-y-4">
      <DataTable
        key={refreshKey}
        columns={[
          { key: "name", label: "Supplier", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "email", label: "Email" },
          { key: "phone", label: "Phone" },
        ]}
        fetchData={(params) => api.list(`${base}/suppliers`, params)}
        searchPlaceholder="Search suppliers..."
        emptyTitle="No suppliers yet"
        emptyMessage="Add suppliers to link them to your products."
        emptyIcon="🚚"
        actions={{
          create: <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> New Supplier</button>,
          edit: openEdit,
        }}
      />

      {modal && (
        <Modal open onClose={closeModal} title={modal.mode === "create" ? "New Supplier" : "Edit Supplier"}>
          <div className="space-y-4">
            <div><label className="label">Name</label><input className="input" value={modal.data.name} onChange={(e) => setModal({ ...modal, data: { ...modal.data, name: e.target.value } })} /></div>
            <div><label className="label">Email</label><input className="input" value={modal.data.email || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, email: e.target.value } })} /></div>
            <div><label className="label">Phone</label><input className="input" value={modal.data.phone || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, phone: e.target.value } })} /></div>
            <div><label className="label">Address</label><textarea className="input" rows={2} value={modal.data.address || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, address: e.target.value } })} /></div>
            <div className="flex gap-2 justify-end"><button onClick={closeModal} className="btn-secondary">Cancel</button><button onClick={save} className="btn-primary">{modal.mode === "create" ? "Create" : "Save"}</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
