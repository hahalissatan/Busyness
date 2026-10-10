/**
 * TeamMembers — team member CRUD with skills and workload view.
 */

import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { DataTable } from "../../components/ui/DataTable.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { Plus, Trash } from "../../components/icons.jsx";

export default function TeamMembers() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/tasks`;
  const [modal, setModal] = useState(null);
  const [skillsModal, setSkillsModal] = useState(null);
  const [memberSkills, setMemberSkills] = useState([]);
  const [newSkill, setNewSkill] = useState("");
  const [workload, setWorkload] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const openCreate = () => setModal({ mode: "create", data: { name: "", email: "", phone: "", position: "" } });
  const openEdit = (row) => setModal({ mode: "edit", data: { ...row } });
  const closeModal = () => setModal(null);

  const save = async () => {
    const { id, business_id, created_at, ...body } = modal.data;
    if (modal.mode === "create") await api.post(`${base}/team-members`, body);
    else await api.patch(`${base}/team-members/${id}`, body);
    closeModal();
    setRefreshKey((k) => k + 1);
  };

  const openSkills = async (member) => {
    try {
      const [skills, wl] = await Promise.all([
        api.get(`${base}/team-members/${member.id}/skills`),
        api.get(`${base}/team-members/${member.id}/workload`).catch(() => null),
      ]);
      setMemberSkills(skills.skills || []);
      setWorkload(wl);
    } catch {}
    setSkillsModal({ member });
  };

  const addSkill = async () => {
    if (!newSkill.trim()) return;
    try {
      await api.post(`${base}/team-members/${skillsModal.member.id}/skills`, { skill_name: newSkill.trim() });
      const res = await api.get(`${base}/team-members/${skillsModal.member.id}/skills`);
      setMemberSkills(res.skills || []);
      setNewSkill("");
    } catch (err) { alert(err.message); }
  };

  const removeSkill = async (skillName) => {
    await api.delete(`${base}/team-members/${skillsModal.member.id}/skills/${encodeURIComponent(skillName)}`);
    const res = await api.get(`${base}/team-members/${skillsModal.member.id}/skills`);
    setMemberSkills(res.skills || []);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500"><a href="/tasks" className="text-brand-600 hover:text-brand-700 font-medium">← Back to tasks</a></p>
      </div>

      <DataTable
        key={refreshKey}
        columns={[
          { key: "name", label: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "position", label: "Position", render: (r) => r.position || "—" },
          { key: "email", label: "Email" },
          { key: "phone", label: "Phone", render: (r) => r.phone || "—" },
          { key: "is_active", label: "Status", render: (r) => <Badge color={r.is_active ? "green" : "gray"}>{r.is_active ? "Active" : "Inactive"}</Badge> },
        ]}
        fetchData={(params) => api.list(`${base}/team-members`, params)}
        searchPlaceholder="Search team members..."
        emptyTitle="No team members yet"
        emptyMessage="Add team members to assign tasks and track workload."
        emptyIcon="👥"
        actions={{
          create: <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> New Member</button>,
          edit: openEdit,
          custom: (row) => <button onClick={(e) => { e.stopPropagation(); openSkills(row); }} className="text-brand-600 hover:text-brand-800 p-1">Skills</button>,
        }}
      />

      {modal && (
        <Modal open onClose={closeModal} title={modal.mode === "create" ? "New Team Member" : "Edit Member"}>
          <div className="space-y-4">
            <div><label className="label">Name</label><input className="input" value={modal.data.name} onChange={(e) => setModal({ ...modal, data: { ...modal.data, name: e.target.value } })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Position</label><input className="input" value={modal.data.position || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, position: e.target.value } })} /></div>
              <div><label className="label">Phone</label><input className="input" value={modal.data.phone || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, phone: e.target.value } })} /></div>
            </div>
            <div><label className="label">Email</label><input className="input" value={modal.data.email || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, email: e.target.value } })} /></div>
            <div className="flex gap-2 justify-end"><button onClick={closeModal} className="btn-secondary">Cancel</button><button onClick={save} className="btn-primary">{modal.mode === "create" ? "Create" : "Save"}</button></div>
          </div>
        </Modal>
      )}

      {skillsModal && (
        <Modal open onClose={() => setSkillsModal(null)} title={`Skills — ${skillsModal.member.name}`}>
          <div className="space-y-4">
            {/* Workload */}
            {workload && (
              <div className="p-4 rounded-lg bg-gray-50">
                <h4 className="text-sm font-semibold mb-2">Workload</h4>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div><p className="text-gray-400">Total Hours</p><p className="font-bold">{workload.total_estimated_hours || 0}h</p></div>
                  <div><p className="text-gray-400">Active Tasks</p><p className="font-bold">{workload.active_task_count || 0}</p></div>
                  <div><p className="text-gray-400">Utilization</p><p className="font-bold">{workload.utilization_percent || 0}%</p></div>
                </div>
              </div>
            )}

            {/* Skills */}
            <div>
              <h4 className="text-sm font-semibold mb-2">Skills</h4>
              <div className="flex flex-wrap gap-2 mb-3">
                {memberSkills.length ? memberSkills.map((s) => (
                  <span key={s.skill_name} className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-brand-50 text-brand-700 text-sm">
                    {s.skill_name}
                    <button onClick={() => removeSkill(s.skill_name)} className="text-brand-400 hover:text-red-600"><Trash className="w-3 h-3" /></button>
                  </span>
                )) : <p className="text-sm text-gray-400">No skills added yet.</p>}
              </div>
              <div className="flex gap-2">
                <input className="input flex-1" placeholder="Add a skill..." value={newSkill} onChange={(e) => setNewSkill(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSkill()} />
                <button onClick={addSkill} className="btn-primary">Add</button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
