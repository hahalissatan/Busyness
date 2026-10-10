/**
 * TaskList — task CRUD with status, priority, and assignment management.
 */

import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { DataTable } from "../../components/ui/DataTable.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { Plus } from "../../components/icons.jsx";

export default function TaskList() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/tasks`;
  const [modal, setModal] = useState(null);
  const [members, setMembers] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    api.list(`${base}/team-members`, { limit: 100 }).then((r) => setMembers(r.data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id]);

  const openCreate = () => setModal({ mode: "create", data: { title: "", description: "", priority: "medium", assigned_to: "" } });
  const openEdit = (row) => setModal({ mode: "edit", data: { ...row } });
  const closeModal = () => setModal(null);

  const save = async () => {
    const { id, business_id, status, source, agent_run_id, created_at, updated_at, ...body } = modal.data;
    if (body.assigned_to === "") delete body.assigned_to;
    if (modal.mode === "create") await api.post(`${base}/tasks`, body);
    else await api.patch(`${base}/tasks/${id}`, body);
    closeModal();
    setRefreshKey((k) => k + 1);
  };

  const changeStatus = async (task, newStatus) => {
    try {
      await api.patch(`${base}/tasks/${task.id}/status`, { status: newStatus });
      setRefreshKey((k) => k + 1);
    } catch (err) { alert(err.message); }
  };

  const deleteTask = async (task) => {
    if (!confirm(`Delete "${task.title}"?`)) return;
    await api.delete(`${base}/tasks/${task.id}`);
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          <a href="/tasks/team" className="text-brand-600 hover:text-brand-700 font-medium">Manage team members →</a>
        </p>
      </div>

      <DataTable
        key={refreshKey}
        columns={[
          { key: "title", label: "Task", render: (r) => <span className="font-medium">{r.title}</span> },
          { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
          { key: "priority", label: "Priority", render: (r) => <Badge color={{ low: "gray", medium: "blue", high: "yellow", urgent: "red" }[r.priority]}>{r.priority}</Badge> },
          { key: "assigned_to_name", label: "Assigned", render: (r) => r.assigned_to_name || "Unassigned" },
          { key: "due_date", label: "Due", render: (r) => r.due_date ? new Date(r.due_date).toLocaleDateString() : "—" },
        ]}
        fetchData={(params) => api.list(`${base}/tasks`, params)}
        searchPlaceholder="Search tasks..."
        emptyTitle="No tasks yet"
        emptyMessage="Create tasks and assign them to your team."
        emptyIcon="✅"
        actions={{
          create: <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> New Task</button>,
          edit: openEdit,
          custom: (row) => {
            if (row.status === "pending") return <button onClick={(e) => { e.stopPropagation(); changeStatus(row, "in_progress"); }} className="text-blue-600 p-1">Start</button>;
            if (row.status === "in_progress") return <button onClick={(e) => { e.stopPropagation(); changeStatus(row, "completed"); }} className="text-green-600 p-1">Complete</button>;
            return null;
          },
          delete: deleteTask,
        }}
      />

      {modal && (
        <Modal open onClose={closeModal} title={modal.mode === "create" ? "New Task" : "Edit Task"}>
          <div className="space-y-4">
            <div><label className="label">Title</label><input className="input" value={modal.data.title} onChange={(e) => setModal({ ...modal, data: { ...modal.data, title: e.target.value } })} /></div>
            <div><label className="label">Description</label><textarea className="input" rows={3} value={modal.data.description || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, description: e.target.value } })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Priority</label><select className="input" value={modal.data.priority} onChange={(e) => setModal({ ...modal, data: { ...modal.data, priority: e.target.value } })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
              <div><label className="label">Assign To</label><select className="input" value={modal.data.assigned_to || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, assigned_to: e.target.value } })}><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
            </div>
            <div><label className="label">Due Date</label><input type="date" className="input" value={modal.data.due_date ? modal.data.due_date.slice(0, 10) : ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, due_date: e.target.value } })} /></div>
            <div className="flex gap-2 justify-end"><button onClick={closeModal} className="btn-secondary">Cancel</button><button onClick={save} className="btn-primary">{modal.mode === "create" ? "Create" : "Save"}</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
