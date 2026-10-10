/**
 * Projects — marketing project CRUD with status management.
 * Backend schema: name, description, status (draft→active→completed).
 * No target_audience field in backend — removed.
 * Added: error handling, submitting state, field validation, status filter,
 * persona_count + draft_count columns.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { DataTable } from "../../components/ui/DataTable.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { Plus } from "../../components/icons.jsx";

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
];

const PROJECT_TRANSITIONS = {
  draft: [{ to: "active", label: "Activate", className: "text-blue-600" }],
  active: [{ to: "completed", label: "Complete", className: "text-green-600" }],
  completed: [],
};

export default function Projects() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/marketing`;
  const navigate = useNavigate();
  const [modal, setModal] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const openCreate = () => {
    setFormError(null);
    setModal({ mode: "create", data: { name: "", description: "" } });
  };
  const openEdit = (row) => {
    setFormError(null);
    setModal({ mode: "edit", data: { ...row } });
  };
  const closeModal = () => { if (!submitting) setModal(null); };

  const save = async () => {
    // Validate
    if (!modal.data.name?.trim()) {
      setFormError("Project name is required.");
      return;
    }
    if (modal.data.name.length > 200) {
      setFormError("Project name must be 200 characters or less.");
      return;
    }
    if (modal.data.description && modal.data.description.length > 5000) {
      setFormError("Description must be 5000 characters or less.");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      // Backend schema: { name, description, status (default draft) }
      // No target_audience field — removed
      const payload = {
        name: modal.data.name.trim(),
        description: modal.data.description?.trim() || null,
      };

      if (modal.mode === "create") {
        const res = await api.post(`${base}/projects`, payload);
        navigate(`/marketing/projects/${res.id}`);
      } else {
        // Strip backend-managed fields before PATCH
        const { id, business_id, status, created_at, updated_at, persona_count, draft_count, pitch_deck_count, ...body } = modal.data;
        await api.patch(`${base}/projects/${id}`, {
          name: body.name?.trim(),
          description: body.description?.trim() || null,
        });
        closeModal();
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      setFormError(err.message || "Failed to save project.");
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (project, newStatus) => {
    setActionError(null);
    try {
      await api.patch(`${base}/projects/${project.id}/status`, { status: newStatus });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(err.message);
    }
  };

  const deleteProject = async (project) => {
    if (!confirm(`Delete "${project.name}"? This will fail if linked personas, drafts, or pitch decks exist.`)) return;
    setActionError(null);
    try {
      await api.delete(`${base}/projects/${project.id}`);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(err.message);
    }
  };

  return (
    <div className="space-y-4">
      {actionError && (
        <div className="card bg-red-50 border-red-200 text-red-700 text-sm">
          {actionError}
        </div>
      )}

      <DataTable
        key={refreshKey}
        columns={[
          { key: "name", label: "Project", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
          { key: "persona_count", label: "Personas", render: (r) => r.persona_count ?? 0 },
          { key: "draft_count", label: "Drafts", render: (r) => r.draft_count ?? 0 },
          { key: "pitch_deck_count", label: "Pitch Decks", render: (r) => r.pitch_deck_count ?? 0 },
          { key: "created_at", label: "Created", render: (r) => new Date(r.created_at).toLocaleDateString() },
        ]}
        fetchData={(params) => {
          const finalParams = { ...params };
          if (statusFilter) finalParams.status = statusFilter;
          return api.list(`${base}/projects`, finalParams);
        }}
        onRowClick={(row) => navigate(`/marketing/projects/${row.id}`)}
        searchPlaceholder="Search projects..."
        emptyTitle="No marketing projects yet"
        emptyMessage="Create a project to manage personas, drafts, and pitch decks."
        emptyIcon="📢"
        filters={
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setRefreshKey((k) => k + 1); }}
            className="input !w-auto"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        }
        actions={{
          create: <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> New Project</button>,
          edit: openEdit,
          custom: (row) => {
            const transitions = PROJECT_TRANSITIONS[row.status] || [];
            return transitions.map((t) => (
              <button
                key={t.to}
                onClick={(e) => { e.stopPropagation(); changeStatus(row, t.to); }}
                className={`p-1 ${t.className}`}
              >
                {t.label}
              </button>
            ));
          },
          delete: deleteProject,
        }}
      />

      {modal && (
        <Modal open onClose={closeModal} title={modal.mode === "create" ? "New Marketing Project" : "Edit Project"}>
          <div className="space-y-4">
            {formError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {formError}
              </div>
            )}
            <div>
              <label className="label">Name <span className="text-red-500">*</span></label>
              <input
                className="input"
                value={modal.data.name || ""}
                onChange={(e) => setModal({ ...modal, data: { ...modal.data, name: e.target.value } })}
                placeholder="e.g. Q1 Launch Campaign"
                maxLength={200}
                disabled={submitting}
              />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea
                className="input"
                rows={3}
                value={modal.data.description || ""}
                onChange={(e) => setModal({ ...modal, data: { ...modal.data, description: e.target.value } })}
                placeholder="Brief project overview (max 5000 chars)"
                maxLength={5000}
                disabled={submitting}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={closeModal} className="btn-secondary" disabled={submitting}>Cancel</button>
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
