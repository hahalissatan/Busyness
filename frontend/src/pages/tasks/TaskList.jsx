/**
 * TaskList — task CRUD with status, priority, and assignment management.
 *
 * Backend contract (routes/tasks.js):
 *   POST   /tasks                       — Create task
 *   GET    /tasks                       — List (status + priority + assignee + overdue filters)
 *   GET    /tasks/:taskId               — Get detail (with assignments array)
 *   PATCH  /tasks/:taskId               — Update details (NOT status — separate endpoint)
 *   PATCH  /tasks/:taskId/status         — Change status (validated transitions)
 *   DELETE /tasks/:taskId               — Delete task (CASCADE to assignments)
 *   POST   /tasks/:taskId/assignments    — Assign to employee { employee_id }
 *   GET    /tasks/:taskId/assignments     — List assignments for a task
 *   PATCH  /tasks/:taskId/assignments/:assignmentId — Change assignment status (active→completed/reassigned)
 *   DELETE /tasks/:taskId/assignments/:assignmentId — Remove assignment
 *
 * Task fields: title, description, priority, deadline (ISO datetime), estimated_hours
 * Task status: pending → in_progress → completed | cancelled
 *              pending → completed/cancelled (also valid)
 *              completed, cancelled are terminal
 *
 * Assignment: separate from task creation. Task list returns `assignments` JSON array:
 *   [{ id, employee_id, employee_name, status, assigned_at }]
 * Assignment status: active → completed | reassigned (only from active)
 */

import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { DataTable } from "../../components/ui/DataTable.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { Plus, Trash } from "../../components/icons.jsx";

const PRIORITIES = ["low", "medium", "high", "urgent"];
const STATUSES = ["pending", "in_progress", "completed", "cancelled"];

// Valid status transitions from the backend
const VALID_TRANSITIONS = {
  pending: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const EMPTY_FORM = {
  title: "",
  description: "",
  priority: "medium",
  deadline: "",
  estimated_hours: "",
};

export default function TaskList() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/tasks`;
  const [modal, setModal] = useState(null);
  const [members, setMembers] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);

  // Assignment modal state
  const [assignModal, setAssignModal] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [assignMember, setAssignMember] = useState("");
  const [assignError, setAssignError] = useState(null);
  const [assignSubmitting, setAssignSubmitting] = useState(false);

  useEffect(() => {
    api
      .list(`${base}/team-members`, { limit: 100 })
      .then((r) => setMembers(r.data || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id]);

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
        title: row.title || "",
        description: row.description || "",
        priority: row.priority || "medium",
        deadline: row.deadline ? row.deadline.slice(0, 16) : "",
        estimated_hours: row.estimated_hours != null ? String(row.estimated_hours) : "",
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

    const { id, business_id, status, source, agent_run_id, created_at, updated_at, assignments, ...rest } =
      modal.data;

    const payload = {
      title: rest.title,
      description: rest.description || null,
      priority: rest.priority,
    };

    // Convert deadline from datetime-local to ISO 8601
    if (rest.deadline) {
      payload.deadline = new Date(rest.deadline).toISOString();
    } else {
      payload.deadline = null;
    }

    if (rest.estimated_hours) {
      payload.estimated_hours = parseFloat(rest.estimated_hours);
    } else {
      payload.estimated_hours = null;
    }

    try {
      if (modal.mode === "create") {
        await api.post(`${base}/tasks`, payload);
      } else {
        await api.patch(`${base}/tasks/${id}`, payload);
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
      setFormError(err.message || "Failed to save task.");
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (task, newStatus) => {
    try {
      await api.patch(`${base}/tasks/${task.id}/status`, { status: newStatus });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      alert(err.message || "Failed to change task status.");
    }
  };

  const deleteTask = async (task) => {
    if (!confirm(`Delete "${task.title}"? This will also remove all assignments.`)) return;
    try {
      await api.delete(`${base}/tasks/${task.id}`);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      alert(err.message || "Failed to delete task.");
    }
  };

  // Assignment modal
  const openAssignModal = async (task) => {
    setAssignModal({ task });
    setAssignments([]);
    setAssignMember("");
    setAssignError(null);
    try {
      const res = await api.get(`${base}/tasks/${task.id}/assignments`);
      setAssignments(res.data || []);
    } catch (err) {
      setAssignError(err.message);
    }
  };

  const closeAssignModal = () => {
    setAssignModal(null);
    setAssignments([]);
    setAssignMember("");
    setAssignError(null);
  };

  const assignTask = async () => {
    if (assignSubmitting || !assignMember) return;
    setAssignSubmitting(true);
    setAssignError(null);
    try {
      await api.post(`${base}/tasks/${assignModal.task.id}/assignments`, {
        employee_id: assignMember,
      });
      // Refresh assignments
      const res = await api.get(`${base}/tasks/${assignModal.task.id}/assignments`);
      setAssignments(res.data || []);
      setAssignMember("");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setAssignError(err.message || "Failed to assign task.");
    } finally {
      setAssignSubmitting(false);
    }
  };

  const updateAssignmentStatus = async (assignmentId, newStatus) => {
    try {
      await api.patch(`${base}/tasks/${assignModal.task.id}/assignments/${assignmentId}`, {
        status: newStatus,
      });
      const res = await api.get(`${base}/tasks/${assignModal.task.id}/assignments`);
      setAssignments(res.data || []);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setAssignError(err.message || "Failed to update assignment.");
    }
  };

  const removeAssignment = async (assignmentId) => {
    if (!confirm("Remove this assignment?")) return;
    try {
      await api.delete(`${base}/tasks/${assignModal.task.id}/assignments/${assignmentId}`);
      const res = await api.get(`${base}/tasks/${assignModal.task.id}/assignments`);
      setAssignments(res.data || []);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setAssignError(err.message || "Failed to remove assignment.");
    }
  };

  const handleStatusFilterChange = (v) => {
    setStatusFilter(v);
    setRefreshKey((k) => k + 1);
  };

  const handlePriorityFilterChange = (v) => {
    setPriorityFilter(v);
    setRefreshKey((k) => k + 1);
  };

  // Render status action buttons based on valid transitions
  const renderStatusActions = (row) => {
    const valid = VALID_TRANSITIONS[row.status] || [];
    if (valid.length === 0) return null;

    return (
      <div className="flex gap-1">
        {valid.includes("in_progress") && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              changeStatus(row, "in_progress");
            }}
            className="text-blue-600 hover:text-blue-800 p-1 text-xs"
          >
            Start
          </button>
        )}
        {valid.includes("completed") && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              changeStatus(row, "completed");
            }}
            className="text-green-600 hover:text-green-800 p-1 text-xs"
          >
            Complete
          </button>
        )}
        {valid.includes("cancelled") && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              changeStatus(row, "cancelled");
            }}
            className="text-red-600 hover:text-red-800 p-1 text-xs"
          >
            Cancel
          </button>
        )}
      </div>
    );
  };

  // Format assignments for display in table
  const renderAssignees = (row) => {
    if (!row.assignments || row.assignments.length === 0) return "Unassigned";
    const active = row.assignments.filter((a) => a.status === "active");
    if (active.length === 0) return "Unassigned";
    return active.map((a) => a.employee_name).join(", ");
  };

  const priorityColor = (p) =>
    ({ low: "gray", medium: "blue", high: "yellow", urgent: "red" }[p] || "gray");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <a href="/tasks/team" className="text-sm text-brand-600 hover:text-brand-700 font-medium">
          Manage team members →
        </a>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-500">Status:</label>
        <select
          className="input !py-1.5 !w-auto"
          value={statusFilter}
          onChange={(e) => handleStatusFilterChange(e.target.value)}
        >
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <label className="text-sm text-gray-500 ml-2">Priority:</label>
        <select
          className="input !py-1.5 !w-auto"
          value={priorityFilter}
          onChange={(e) => handlePriorityFilterChange(e.target.value)}
        >
          <option value="">All</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <DataTable
        key={refreshKey}
        columns={[
          { key: "title", label: "Task", render: (r) => <span className="font-medium">{r.title}</span> },
          { key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
          {
            key: "priority",
            label: "Priority",
            render: (r) => <Badge color={priorityColor(r.priority)}>{r.priority}</Badge>,
          },
          { key: "assignments", label: "Assigned", render: (r) => renderAssignees(r) },
          {
            key: "deadline",
            label: "Deadline",
            render: (r) => {
              if (!r.deadline) return "—";
              const d = new Date(r.deadline);
              const isOverdue = d < new Date() && r.status !== "completed" && r.status !== "cancelled";
              return (
                <span className={isOverdue ? "text-red-600 font-medium" : ""}>
                  {d.toLocaleDateString()}
                </span>
              );
            },
          },
          {
            key: "estimated_hours",
            label: "Est. Hours",
            render: (r) => (r.estimated_hours != null ? `${parseFloat(r.estimated_hours)}h` : "—"),
          },
        ]}
        fetchData={(params) => {
          // Backend doesn't support search on tasks — strip it
          const finalParams = { page: params.page, limit: params.limit };
          if (statusFilter) finalParams.status = statusFilter;
          if (priorityFilter) finalParams.priority = priorityFilter;
          return api.list(`${base}/tasks`, finalParams);
        }}
        searchPlaceholder="Filter by status and priority above..."
        emptyTitle="No tasks yet"
        emptyMessage="Create tasks and assign them to your team."
        emptyIcon="✅"
        actions={{
          create: (
            <button onClick={openCreate} className="btn-primary">
              <Plus className="w-4 h-4" /> New Task
            </button>
          ),
          edit: openEdit,
          custom: (row) => (
            <div className="flex gap-1">
              {renderStatusActions(row)}
              {row.status !== "completed" && row.status !== "cancelled" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openAssignModal(row);
                  }}
                  className="text-brand-600 hover:text-brand-800 p-1 text-xs"
                >
                  Assign
                </button>
              )}
            </div>
          ),
          delete: deleteTask,
        }}
      />

      {/* Task create/edit modal */}
      {modal && (
        <Modal
          open
          onClose={closeModal}
          title={modal.mode === "create" ? "New Task" : "Edit Task"}
        >
          <div className="space-y-4">
            {formError && (
              <div className="p-3 rounded-lg bg-red-50 text-red-800 text-sm">{formError}</div>
            )}

            <div>
              <label className="label">Title</label>
              <input
                className="input"
                value={modal.data.title}
                onChange={(e) => setModal({ ...modal, data: { ...modal.data, title: e.target.value } })}
              />
              {fieldErrors.title && <p className="text-xs text-red-600 mt-1">{fieldErrors.title}</p>}
            </div>

            <div>
              <label className="label">Description</label>
              <textarea
                className="input"
                rows={3}
                value={modal.data.description || ""}
                onChange={(e) =>
                  setModal({ ...modal, data: { ...modal.data, description: e.target.value } })
                }
              />
              {fieldErrors.description && (
                <p className="text-xs text-red-600 mt-1">{fieldErrors.description}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Priority</label>
                <select
                  className="input"
                  value={modal.data.priority}
                  onChange={(e) =>
                    setModal({ ...modal, data: { ...modal.data, priority: e.target.value } })
                  }
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                {fieldErrors.priority && (
                  <p className="text-xs text-red-600 mt-1">{fieldErrors.priority}</p>
                )}
              </div>
              <div>
                <label className="label">Deadline</label>
                <input
                  type="datetime-local"
                  className="input"
                  value={modal.data.deadline || ""}
                  onChange={(e) =>
                    setModal({ ...modal, data: { ...modal.data, deadline: e.target.value } })
                  }
                />
                {fieldErrors.deadline && (
                  <p className="text-xs text-red-600 mt-1">{fieldErrors.deadline}</p>
                )}
              </div>
            </div>

            <div>
              <label className="label">Estimated Hours</label>
              <input
                type="number"
                step="0.5"
                min="0"
                className="input"
                value={modal.data.estimated_hours || ""}
                onChange={(e) =>
                  setModal({ ...modal, data: { ...modal.data, estimated_hours: e.target.value } })
                }
              />
              {fieldErrors.estimated_hours && (
                <p className="text-xs text-red-600 mt-1">{fieldErrors.estimated_hours}</p>
              )}
            </div>

            {modal.mode === "edit" && (
              <div className="p-3 rounded-lg bg-blue-50 text-blue-800 text-sm">
                Status: <Badge status={modal.data.status || "pending"} /> — use the status action
                buttons in the table to change task status. Assignment is managed separately via the
                "Assign" button.
              </div>
            )}

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

      {/* Assignment management modal */}
      {assignModal && (
        <Modal
          open
          onClose={closeAssignModal}
          title={`Assignments — ${assignModal.task.title}`}
        >
          <div className="space-y-4">
            {assignError && (
              <div className="p-3 rounded-lg bg-red-50 text-red-800 text-sm">{assignError}</div>
            )}

            {/* Current assignments */}
            <div>
              <h4 className="text-sm font-semibold mb-2">Current Assignments</h4>
              {assignments.length > 0 ? (
                <div className="space-y-2">
                  {assignments.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-gray-50"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{a.employee_name}</span>
                        <Badge status={a.status} />
                        <span className="text-xs text-gray-400">
                          {new Date(a.assigned_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        {a.status === "active" && (
                          <>
                            <button
                              onClick={() => updateAssignmentStatus(a.id, "completed")}
                              className="text-green-600 hover:text-green-800 p-1 text-xs"
                            >
                              Complete
                            </button>
                            <button
                              onClick={() => updateAssignmentStatus(a.id, "reassigned")}
                              className="text-yellow-600 hover:text-yellow-800 p-1 text-xs"
                            >
                              Reassign
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => removeAssignment(a.id)}
                          className="text-red-600 hover:text-red-800 p-1 text-xs"
                        >
                          <Trash className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No assignments yet.</p>
              )}
            </div>

            {/* New assignment */}
            <div className="pt-3 border-t border-gray-100">
              <h4 className="text-sm font-semibold mb-2">Assign to Team Member</h4>
              <div className="flex gap-2">
                <select
                  className="input flex-1"
                  value={assignMember}
                  onChange={(e) => setAssignMember(e.target.value)}
                >
                  <option value="">Select member...</option>
                  {members
                    .filter((m) => m.availability !== "unavailable" && m.availability !== "on_leave")
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.role}, {m.availability})
                      </option>
                    ))}
                </select>
                <button
                  onClick={assignTask}
                  className="btn-primary"
                  disabled={!assignMember || assignSubmitting}
                >
                  {assignSubmitting ? "Assigning..." : "Assign"}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Only available and busy team members are shown. Unavailable and on-leave members
                are excluded.
              </p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
