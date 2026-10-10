/**
 * TeamMembers — team member CRUD with skills and workload view.
 *
 * Backend contract (routes/tasks.js):
 *   POST   /team-members                    — Create employee
 *   GET    /team-members                    — List (search + availability filter)
 *   GET    /team-members/:employeeId        — Get detail (with skills + active_task_count)
 *   PATCH  /team-members/:employeeId        — Update employee
 *   GET    /team-members/:employeeId/skills  — List employee skills → { data: [...] }
 *   POST   /team-members/:employeeId/skills — Add skill (requires { skill_id, proficiency })
 *   DELETE /team-members/:employeeId/skills/:skillId — Remove skill (skillId = UUID)
 *   GET    /team-members/:employeeId/workload — Member workload detail
 *
 * Employee fields: name, email, phone, role (manager/staff/contractor),
 *                  availability (available/busy/unavailable/on_leave),
 *                  max_workload_hours (int, default 40)
 *
 * NOTE: Adding skills requires a skill_id UUID from the skills table.
 *       The backend does NOT expose a "list all skills" endpoint.
 *       Skill creation is therefore a backend limitation — existing skills
 *       can be viewed and removed, but adding new skills is not supported
 *       without a skill catalog endpoint.
 */

import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { DataTable } from "../../components/ui/DataTable.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { Plus, Trash } from "../../components/icons.jsx";

const ROLES = ["manager", "staff", "contractor"];
const AVAILABILITY_OPTIONS = ["available", "busy", "unavailable", "on_leave"];

const EMPTY_FORM = {
  name: "",
  email: "",
  phone: "",
  role: "staff",
  availability: "available",
  max_workload_hours: "40",
};

export default function TeamMembers() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/tasks`;
  const [modal, setModal] = useState(null);
  const [skillsModal, setSkillsModal] = useState(null);
  const [memberDetail, setMemberDetail] = useState(null);
  const [workload, setWorkload] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [availabilityFilter, setAvailabilityFilter] = useState("");
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
        email: row.email || "",
        phone: row.phone || "",
        role: row.role || "staff",
        availability: row.availability || "available",
        max_workload_hours: row.max_workload_hours != null ? String(row.max_workload_hours) : "40",
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

    const { id, business_id, created_at, updated_at, active_task_count, ...rest } = modal.data;

    const payload = {
      name: rest.name,
      email: rest.email || null,
      phone: rest.phone || null,
      role: rest.role,
      availability: rest.availability,
      max_workload_hours: parseInt(rest.max_workload_hours, 10) || 40,
    };

    try {
      if (modal.mode === "create") {
        await api.post(`${base}/team-members`, payload);
      } else {
        await api.patch(`${base}/team-members/${id}`, payload);
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
      setFormError(err.message || "Failed to save team member.");
    } finally {
      setSubmitting(false);
    }
  };

  const openSkills = async (member) => {
    setSkillsModal({ member });
    setMemberDetail(null);
    setWorkload(null);
    try {
      const [detail, wl] = await Promise.all([
        api.get(`${base}/team-members/${member.id}`),
        api.get(`${base}/team-members/${member.id}/workload`).catch(() => null),
      ]);
      setMemberDetail(detail);
      setWorkload(wl);
    } catch (err) {
      setFormError(err.message);
    }
  };

  const closeSkillsModal = () => {
    setSkillsModal(null);
    setMemberDetail(null);
    setWorkload(null);
  };

  const removeSkill = async (skillId) => {
    if (!confirm("Remove this skill from the employee?")) return;
    try {
      await api.delete(`${base}/team-members/${skillsModal.member.id}/skills/${skillId}`);
      // Refresh employee detail
      const detail = await api.get(`${base}/team-members/${skillsModal.member.id}`);
      setMemberDetail(detail);
    } catch (err) {
      alert(err.message || "Failed to remove skill.");
    }
  };

  const handleFilterChange = (v) => {
    setAvailabilityFilter(v);
    setRefreshKey((k) => k + 1);
  };

  const availabilityColor = (a) =>
    ({
      available: "green",
      busy: "yellow",
      unavailable: "red",
      on_leave: "gray",
    }[a] || "gray");

  const roleColor = (r) =>
    ({
      manager: "blue",
      staff: "gray",
      contractor: "purple",
    }[r] || "gray");

  const proficiencyColor = (p) =>
    ({
      beginner: "gray",
      intermediate: "blue",
      advanced: "indigo",
      expert: "green",
    }[p] || "gray");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <a href="/tasks" className="text-sm text-brand-600 hover:text-brand-700 font-medium">
          ← Back to tasks
        </a>
      </div>

      {/* Availability filter */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-500">Filter:</label>
        <select
          className="input !py-1.5 !w-auto"
          value={availabilityFilter}
          onChange={(e) => handleFilterChange(e.target.value)}
        >
          <option value="">All members</option>
          {AVAILABILITY_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {a.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      <DataTable
        key={refreshKey}
        columns={[
          { key: "name", label: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
          {
            key: "role",
            label: "Role",
            render: (r) => <Badge color={roleColor(r.role)}>{r.role}</Badge>,
          },
          { key: "email", label: "Email", render: (r) => r.email || "—" },
          { key: "phone", label: "Phone", render: (r) => r.phone || "—" },
          {
            key: "availability",
            label: "Availability",
            render: (r) => (
              <Badge color={availabilityColor(r.availability)}>{r.availability?.replace(/_/g, " ")}</Badge>
            ),
          },
          {
            key: "active_task_count",
            label: "Active Tasks",
            render: (r) => (r.active_task_count != null ? r.active_task_count : "—"),
          },
        ]}
        fetchData={(params) => {
          const finalParams = { ...params };
          if (availabilityFilter) finalParams.availability = availabilityFilter;
          return api.list(`${base}/team-members`, finalParams);
        }}
        searchPlaceholder="Search team members..."
        emptyTitle="No team members yet"
        emptyMessage="Add team members to assign tasks and track workload."
        emptyIcon="👥"
        actions={{
          create: (
            <button onClick={openCreate} className="btn-primary">
              <Plus className="w-4 h-4" /> New Member
            </button>
          ),
          edit: openEdit,
          custom: (row) => (
            <button
              onClick={(e) => {
                e.stopPropagation();
                openSkills(row);
              }}
              className="text-brand-600 hover:text-brand-800 p-1"
            >
              Skills & Workload
            </button>
          ),
        }}
      />

      {modal && (
        <Modal
          open
          onClose={closeModal}
          title={modal.mode === "create" ? "New Team Member" : "Edit Member"}
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
              {fieldErrors.name && <p className="text-xs text-red-600 mt-1">{fieldErrors.name}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Role</label>
                <select
                  className="input"
                  value={modal.data.role}
                  onChange={(e) => setModal({ ...modal, data: { ...modal.data, role: e.target.value } })}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                {fieldErrors.role && <p className="text-xs text-red-600 mt-1">{fieldErrors.role}</p>}
              </div>
              <div>
                <label className="label">Availability</label>
                <select
                  className="input"
                  value={modal.data.availability}
                  onChange={(e) =>
                    setModal({ ...modal, data: { ...modal.data, availability: e.target.value } })
                  }
                >
                  {AVAILABILITY_OPTIONS.map((a) => (
                    <option key={a} value={a}>
                      {a.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                {fieldErrors.availability && (
                  <p className="text-xs text-red-600 mt-1">{fieldErrors.availability}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  className="input"
                  value={modal.data.email || ""}
                  onChange={(e) => setModal({ ...modal, data: { ...modal.data, email: e.target.value } })}
                />
                {fieldErrors.email && <p className="text-xs text-red-600 mt-1">{fieldErrors.email}</p>}
              </div>
              <div>
                <label className="label">Phone</label>
                <input
                  className="input"
                  value={modal.data.phone || ""}
                  onChange={(e) => setModal({ ...modal, data: { ...modal.data, phone: e.target.value } })}
                />
                {fieldErrors.phone && <p className="text-xs text-red-600 mt-1">{fieldErrors.phone}</p>}
              </div>
            </div>

            <div>
              <label className="label">Max Workload Hours</label>
              <input
                type="number"
                min="1"
                step="1"
                className="input"
                value={modal.data.max_workload_hours || ""}
                onChange={(e) =>
                  setModal({ ...modal, data: { ...modal.data, max_workload_hours: e.target.value } })
                }
              />
              {fieldErrors.max_workload_hours && (
                <p className="text-xs text-red-600 mt-1">{fieldErrors.max_workload_hours}</p>
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

      {skillsModal && (
        <Modal open onClose={closeSkillsModal} title={`Skills & Workload — ${skillsModal.member.name}`}>
          <div className="space-y-4">
            {/* Workload */}
            {workload ? (
              <div className="p-4 rounded-lg bg-gray-50">
                <h4 className="text-sm font-semibold mb-3">Workload</h4>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-gray-400 text-xs">Allocated Hours</p>
                    <p className="font-bold">{workload.allocated_hours ?? 0}h</p>
                    <p className="text-gray-400 text-xs">of {workload.max_workload_hours ?? 40}h max</p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-xs">Active Assignments</p>
                    <p className="font-bold">{workload.active_assignments ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-xs">Utilization</p>
                    <p
                      className={`font-bold ${
                        (workload.utilization_percent ?? 0) >= 100
                          ? "text-red-600"
                          : (workload.utilization_percent ?? 0) >= 80
                          ? "text-yellow-600"
                          : ""
                      }`}
                    >
                      {workload.utilization_percent ?? 0}%
                    </p>
                  </div>
                </div>
                {workload.task_breakdown && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div>
                        <span className="text-gray-400">Pending: </span>
                        <span className="font-medium">{workload.task_breakdown.pending ?? 0}</span>
                      </div>
                      <div>
                        <span className="text-gray-400">In Progress: </span>
                        <span className="font-medium">{workload.task_breakdown.in_progress ?? 0}</span>
                      </div>
                      <div>
                        <span className="text-gray-400">Completed: </span>
                        <span className="font-medium">{workload.task_breakdown.completed ?? 0}</span>
                      </div>
                      <div>
                        <span className="text-gray-400">Overdue: </span>
                        <span className="font-medium text-red-600">{workload.overdue_assigned_tasks ?? 0}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-gray-50 text-sm text-gray-400">Loading workload...</div>
            )}

            {/* Skills */}
            <div>
              <h4 className="text-sm font-semibold mb-2">Skills</h4>
              {memberDetail?.skills && memberDetail.skills.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {memberDetail.skills.map((s) => (
                    <span
                      key={s.skill_id}
                      className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 text-brand-700 text-sm"
                    >
                      {s.skill_name}
                      <Badge color={proficiencyColor(s.proficiency)}>{s.proficiency}</Badge>
                      <button
                        onClick={() => removeSkill(s.skill_id)}
                        className="text-brand-400 hover:text-red-600"
                      >
                        <Trash className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No skills assigned yet.</p>
              )}
              <p className="text-xs text-gray-400 mt-3">
                Note: Adding skills requires a skill catalog endpoint that is not yet available in the backend.
                Existing skills can be viewed and removed.
              </p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
