/**
 * Projects — marketing project CRUD with status management.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { DataTable } from "../../components/ui/DataTable.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { Plus } from "../../components/icons.jsx";

export default function Projects() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/marketing`;
  const navigate = useNavigate();
  const [modal, setModal] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const openCreate = () => setModal({ mode: "create", data: { name: "", description: "", target_audience: "" } });
  const openEdit = (row) => setModal({ mode: "edit", data: { ...row } });
  const closeModal = () => setModal(null);

  const save = async () => {
    const { id, business_id, status, created_at, updated_at, pitch_deck_count, ...body } = modal.data;
    if (modal.mode === "create") {
      const res = await api.post(`${base}/projects`, body);
      navigate(`/marketing/projects/${res.id}`);
    } else {
      await api.patch(`${base}/projects/${id}`, body);
      closeModal();
      setRefreshKey((k) => k + 1);
    }
  };

  const changeStatus = async (project, newStatus) => {
    try {
      await api.patch(`${base}/projects/${project.id}/status`, { status: newStatus });
      setRefreshKey((k) => k + 1);
    } catch (err) { alert(err.message); }
  };

  const deleteProject = async (project) => {
    if (!confirm(`Delete "${project.name}"? This will fail if linked resources exist.`)) return;
    try {
      await api.delete(`${base}/projects/${project.id}`);
      setRefreshKey((k) => k + 1);
    } catch (err) { alert(err.message); }
  };

  return (
    <div className="space-y-4">
      <DataTable
        key={refreshKey}
        columns={[
          { key: "name", label: "Project", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
          { key: "target_audience", label: "Audience", render: (r) => r.target_audience || "—" },
          { key: "pitch_deck_count", label: "Pitch Decks", render: (r) => r.pitch_deck_count || 0 },
          { key: "created_at", label: "Created", render: (r) => new Date(r.created_at).toLocaleDateString() },
        ]}
        fetchData={(params) => api.list(`${base}/projects`, params)}
        onRowClick={(row) => navigate(`/marketing/projects/${row.id}`)}
        searchPlaceholder="Search projects..."
        emptyTitle="No marketing projects yet"
        emptyMessage="Create a project to manage personas, drafts, and pitch decks."
        emptyIcon="📢"
        actions={{
          create: <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> New Project</button>,
          edit: openEdit,
          custom: (row) => {
            if (row.status === "draft") return <button onClick={(e) => { e.stopPropagation(); changeStatus(row, "active"); }} className="text-blue-600 p-1">Activate</button>;
            if (row.status === "active") return <button onClick={(e) => { e.stopPropagation(); changeStatus(row, "completed"); }} className="text-green-600 p-1">Complete</button>;
            return null;
          },
          delete: deleteProject,
        }}
      />

      {modal && (
        <Modal open onClose={closeModal} title={modal.mode === "create" ? "New Marketing Project" : "Edit Project"}>
          <div className="space-y-4">
            <div><label className="label">Name</label><input className="input" value={modal.data.name} onChange={(e) => setModal({ ...modal, data: { ...modal.data, name: e.target.value } })} /></div>
            <div><label className="label">Description</label><textarea className="input" rows={3} value={modal.data.description || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, description: e.target.value } })} /></div>
            <div><label className="label">Target Audience</label><input className="input" value={modal.data.target_audience || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, target_audience: e.target.value } })} /></div>
            <div className="flex gap-2 justify-end"><button onClick={closeModal} className="btn-secondary">Cancel</button><button onClick={save} className="btn-primary">{modal.mode === "create" ? "Create" : "Save"}</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
