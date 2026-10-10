/**
 * ProjectDetail — personas, drafts, pitch decks with AI generation (demo).
 *
 * Backend endpoints used:
 *   GET    /projects/:projectId                — project detail (summary arrays)
 *   GET    /projects/:projectId/drafts         — full drafts with content
 *   GET    /projects/:projectId/pitch-decks   — full pitch decks with slides
 *   GET    /personas                           — all personas (filter by project_id)
 *   POST   /personas/generate                  — AI persona (field: marketing_project_id)
 *   POST   /projects/:projectId/drafts/generate— AI draft
 *   POST   /projects/:projectId/pitch-decks/generate — AI pitch deck
 *   POST   /personas                           — manual persona create
 *   POST   /projects/:projectId/drafts         — manual draft create
 *   PATCH  /drafts/:draftId/status             — draft status transition
 *   PATCH  /pitch-decks/:pitchDeckId/status    — pitch deck status transition
 *   POST   /drafts/:draftId/revise             — AI revise (field: instructions, plural)
 *   POST   /pitch-decks/:pitchDeckId/revise   — AI revise (field: instructions, plural)
 *   DELETE /drafts/:draftId                    — delete draft
 *   DELETE /personas/:personaId                — delete persona
 *   DELETE /pitch-decks/:pitchDeckId          — delete pitch deck
 *
 * Status transitions:
 *   Drafts:     draft → reviewed → approved → published (terminal)
 *   Pitch Decks: draft → reviewed → finalized (terminal)
 *   Projects:   draft → active → completed (terminal)
 */

import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { ChevronLeft, Plus, Trash } from "../../components/icons.jsx";

const DRAFT_TYPES = [
  { value: "social_media", label: "Social Media" },
  { value: "campaign", label: "Campaign" },
  { value: "content", label: "Content" },
  { value: "email", label: "Email" },
];

const DRAFT_TRANSITIONS = {
  draft: [{ to: "reviewed", label: "Mark Reviewed" }],
  reviewed: [{ to: "approved", label: "Approve" }],
  approved: [{ to: "published", label: "Publish" }],
  published: [],
};

const PITCH_TRANSITIONS = {
  draft: [{ to: "reviewed", label: "Mark Reviewed" }],
  reviewed: [{ to: "finalized", label: "Finalize" }],
  finalized: [],
};

export default function ProjectDetail() {
  const { id } = useParams();
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/marketing`;

  // --- State ---
  const [project, setProject] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [pitchDecks, setPitchDecks] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("drafts");
  const [genLoading, setGenLoading] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [actionError, setActionError] = useState(null);

  // Modals
  const [draftModal, setDraftModal] = useState(null);
  const [personaModal, setPersonaModal] = useState(null);
  const [reviseModal, setReviseModal] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  // --- Data loaders ---
  const loadProject = useCallback(async () => {
    const res = await api.get(`${base}/projects/${id}`);
    setProject(res);
  }, [base, id]);

  const loadDrafts = useCallback(async () => {
    const res = await api.list(`${base}/projects/${id}/drafts`, { limit: 100 });
    setDrafts(res.data);
  }, [base, id]);

  const loadPitchDecks = useCallback(async () => {
    const res = await api.list(`${base}/projects/${id}/pitch-decks`, { limit: 100 });
    setPitchDecks(res.data);
  }, [base, id]);

  const loadPersonas = useCallback(async () => {
    // GET /personas returns all business personas — filter by project_id
    const res = await api.list(`${base}/personas`, { limit: 100 });
    setPersonas(res.data.filter((p) => p.marketing_project_id === id));
  }, [base, id]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadProject(), loadDrafts(), loadPitchDecks(), loadPersonas()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [loadProject, loadDrafts, loadPitchDecks, loadPersonas]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // --- Reload helper (after mutations) ---
  const reload = async (what) => {
    setActionError(null);
    try {
      if (what === "all" || what === "project") await loadProject();
      if (what === "all" || what === "drafts") await loadDrafts();
      if (what === "all" || what === "pitch") await loadPitchDecks();
      if (what === "all" || what === "personas") {
        await loadProject(); // update counts
        await loadPersonas();
      }
    } catch (err) {
      setActionError(err.message);
    }
  };

  // --- AI Generation ---
  const handleGeneratePersona = async () => {
    setGenLoading("persona");
    setActionError(null);
    try {
      // FIX: backend expects marketing_project_id, NOT project_id
      await api.post(`${base}/personas/generate`, { marketing_project_id: id });
      await reload("personas");
    } catch (err) {
      setActionError(err.message);
    } finally {
      setGenLoading(null);
    }
  };

  const handleGenerateDraft = async () => {
    setGenLoading("draft");
    setActionError(null);
    try {
      await api.post(`${base}/projects/${id}/drafts/generate`, { draft_type: "social_media" });
      await reload("drafts");
    } catch (err) {
      setActionError(err.message);
    } finally {
      setGenLoading(null);
    }
  };

  const handleGeneratePitchDeck = async () => {
    setGenLoading("pitch");
    setActionError(null);
    try {
      await api.post(`${base}/projects/${id}/pitch-decks/generate`, {});
      await reload("pitch");
    } catch (err) {
      setActionError(err.message);
    } finally {
      setGenLoading(null);
    }
  };

  // --- Status transitions ---
  const handleDraftStatus = async (draftId, newStatus) => {
    setActionLoading(`draft-${draftId}`);
    setActionError(null);
    try {
      await api.patch(`${base}/drafts/${draftId}/status`, { status: newStatus });
      await loadDrafts();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handlePitchStatus = async (deckId, newStatus) => {
    setActionLoading(`pitch-${deckId}`);
    setActionError(null);
    try {
      await api.patch(`${base}/pitch-decks/${deckId}/status`, { status: newStatus });
      await loadPitchDecks();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  // --- Revise (AI) ---
  const handleRevise = async () => {
    if (!reviseModal?.instructions?.trim()) {
      setFormError("Revision instructions are required.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      // FIX: backend expects "instructions" (plural), NOT "instruction"
      if (reviseModal.type === "draft") {
        await api.post(`${base}/drafts/${reviseModal.id}/revise`, {
          instructions: reviseModal.instructions.trim(),
        });
        await loadDrafts();
      } else if (reviseModal.type === "pitch") {
        await api.post(`${base}/pitch-decks/${reviseModal.id}/revise`, {
          instructions: reviseModal.instructions.trim(),
        });
        await loadPitchDecks();
      }
      setReviseModal(null);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // --- Delete ---
  const handleDeleteDraft = async (draftId, title) => {
    if (!confirm(`Delete draft "${title}"?`)) return;
    setActionLoading(`del-draft-${draftId}`);
    setActionError(null);
    try {
      await api.delete(`${base}/drafts/${draftId}`);
      await reload("drafts");
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeletePersona = async (personaId, name) => {
    if (!confirm(`Delete persona "${name}"?`)) return;
    setActionLoading(`del-persona-${personaId}`);
    setActionError(null);
    try {
      await api.delete(`${base}/personas/${personaId}`);
      await reload("personas");
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeletePitchDeck = async (deckId, title) => {
    if (!confirm(`Delete pitch deck "${title}"?`)) return;
    setActionLoading(`del-pitch-${deckId}`);
    setActionError(null);
    try {
      await api.delete(`${base}/pitch-decks/${deckId}`);
      await reload("pitch");
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  // --- Manual create ---
  const handleCreateDraft = async () => {
    if (!draftModal?.title?.trim()) { setFormError("Title is required."); return; }
    if (!draftModal?.content?.trim()) { setFormError("Content is required."); return; }
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post(`${base}/projects/${id}/drafts`, {
        draft_type: draftModal.draft_type,
        title: draftModal.title.trim(),
        content: draftModal.content.trim(),
        platform: draftModal.platform?.trim() || null,
      });
      setDraftModal(null);
      await reload("drafts");
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreatePersona = async () => {
    if (!personaModal?.name?.trim()) { setFormError("Persona name is required."); return; }
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post(`${base}/personas`, {
        name: personaModal.name.trim(),
        description: personaModal.description?.trim() || null,
        pain_points: personaModal.pain_points?.trim() || null,
        motivations: personaModal.motivations?.trim() || null,
        target_segment: personaModal.target_segment?.trim() || null,
        marketing_project_id: id,
      });
      setPersonaModal(null);
      await reload("personas");
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // --- Render ---
  if (loading) return <Spinner size="lg" />;
  if (error) return <div className="card text-red-600">{error}</div>;
  if (!project) return <div className="card">Project not found.</div>;

  const tabs = [
    { key: "drafts", label: "Drafts", count: drafts.length },
    { key: "personas", label: "Personas", count: personas.length },
    { key: "pitch", label: "Pitch Decks", count: pitchDecks.length },
  ];

  return (
    <div className="space-y-6">
      <Link to="/marketing/projects" className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
        <ChevronLeft className="w-4 h-4" /> Back to projects
      </Link>

      {/* Project header — no target_audience field in backend */}
      <div className="card">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold">{project.name}</h2>
            {project.description && <p className="text-sm text-gray-500 mt-1">{project.description}</p>}
          </div>
          <Badge status={project.status} />
        </div>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="card bg-red-50 border-red-200 text-red-700 text-sm">
          {actionError}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? "border-brand-600 text-brand-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {/* Drafts tab */}
      {tab === "drafts" && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <button onClick={() => { setFormError(null); setDraftModal({ draft_type: "social_media", title: "", content: "", platform: "" }); }} className="btn-secondary">
              <Plus className="w-4 h-4 inline" /> New Draft
            </button>
            <button onClick={handleGenerateDraft} disabled={genLoading === "draft"} className="btn-primary">
              {genLoading === "draft" ? "Generating..." : "Generate Draft [Demo]"}
            </button>
          </div>
          {drafts.length ? drafts.map((d) => (
            <div key={d.id} className="card">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className="font-medium">{d.title}</span>
                  <span className="ml-2 text-xs text-gray-400">{d.draft_type}</span>
                  {d.platform && <span className="ml-2 text-xs text-gray-400">· {d.platform}</span>}
                </div>
                <Badge status={d.status} />
              </div>
              <p className="text-sm text-gray-600 whitespace-pre-wrap mb-2">{d.content || "(empty)"}</p>
              {d._generator?.provider === "demo" && <Badge color="purple">Demo Generated</Badge>}
              <div className="flex gap-2 mt-3 flex-wrap">
                {(DRAFT_TRANSITIONS[d.status] || []).map((t) => (
                  <button key={t.to} onClick={() => handleDraftStatus(d.id, t.to)}
                    disabled={actionLoading === `draft-${d.id}`}
                    className="btn-secondary !py-1">{t.label}</button>
                ))}
                <button onClick={() => { setFormError(null); setReviseModal({ type: "draft", id: d.id, title: d.title, instructions: "" }); }}
                  className="btn-secondary !py-1">Revise [Demo]</button>
                <button onClick={() => handleDeleteDraft(d.id, d.title)}
                  disabled={actionLoading === `del-draft-${d.id}`}
                  className="text-red-600 hover:text-red-800 p-1">
                  <Trash className="w-4 h-4" />
                </button>
              </div>
            </div>
          )) : <p className="text-sm text-gray-400 text-center py-8">No drafts yet. Generate one or create manually.</p>}
        </div>
      )}

      {/* Personas tab */}
      {tab === "personas" && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <button onClick={() => { setFormError(null); setPersonaModal({ name: "", description: "", pain_points: "", motivations: "", target_segment: "" }); }} className="btn-secondary">
              <Plus className="w-4 h-4 inline" /> New Persona
            </button>
            <button onClick={handleGeneratePersona} disabled={genLoading === "persona"} className="btn-primary">
              {genLoading === "persona" ? "Generating..." : "Generate Persona [Demo]"}
            </button>
          </div>
          {personas.length ? personas.map((p) => (
            <div key={p.id} className="card">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className="font-medium">{p.name}</span>
                  {p.target_segment && <span className="ml-2 text-xs text-gray-400">· {p.target_segment}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {p._generator?.provider === "demo" && <Badge color="purple">Demo Generated</Badge>}
                  <button onClick={() => handleDeletePersona(p.id, p.name)}
                    disabled={actionLoading === `del-persona-${p.id}`}
                    className="text-red-600 hover:text-red-800 p-1">
                    <Trash className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {/* FIX: backend returns description, pain_points, motivations — NOT demographics or goals */}
              <div className="text-sm text-gray-600 space-y-1">
                {p.description && <p><span className="text-gray-400 font-medium">Description:</span> {p.description}</p>}
                {p.pain_points && <p><span className="text-gray-400 font-medium">Pain points:</span> {p.pain_points}</p>}
                {p.motivations && <p><span className="text-gray-400 font-medium">Motivations:</span> {p.motivations}</p>}
              </div>
            </div>
          )) : <p className="text-sm text-gray-400 text-center py-8">No personas yet. Generate one or create manually.</p>}
        </div>
      )}

      {/* Pitch Decks tab */}
      {tab === "pitch" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={handleGeneratePitchDeck} disabled={genLoading === "pitch"} className="btn-primary">
              {genLoading === "pitch" ? "Generating..." : "Generate Pitch Deck [Demo]"}
            </button>
          </div>
          {pitchDecks.length ? pitchDecks.map((d) => (
            <div key={d.id} className="card">
              <div className="flex items-start justify-between mb-2">
                <span className="font-medium">{d.title}</span>
                <div className="flex items-center gap-2">
                  <Badge status={d.status} />
                  {d._generator?.provider === "demo" && <Badge color="purple">Demo</Badge>}
                </div>
              </div>
              {d.slides && Array.isArray(d.slides) && d.slides.length > 0 && (
                <div className="mt-3 space-y-2">
                  {d.slides.map((slide, i) => (
                    <div key={i} className="p-3 rounded-lg bg-gray-50">
                      <p className="text-sm font-medium">Slide {slide.slide_number}: {slide.heading}</p>
                      {slide.bullet_points && slide.bullet_points.length > 0 && (
                        <ul className="text-xs text-gray-500 mt-1 ml-4 list-disc">
                          {slide.bullet_points.map((b, j) => <li key={j}>{b}</li>)}
                        </ul>
                      )}
                      {slide.speaker_notes && <p className="text-xs text-gray-400 mt-1 italic">{slide.speaker_notes}</p>}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 mt-3 flex-wrap">
                {(PITCH_TRANSITIONS[d.status] || []).map((t) => (
                  <button key={t.to} onClick={() => handlePitchStatus(d.id, t.to)}
                    disabled={actionLoading === `pitch-${d.id}`}
                    className="btn-secondary !py-1">{t.label}</button>
                ))}
                <button onClick={() => { setFormError(null); setReviseModal({ type: "pitch", id: d.id, title: d.title, instructions: "" }); }}
                  className="btn-secondary !py-1">Revise [Demo]</button>
                <button onClick={() => handleDeletePitchDeck(d.id, d.title)}
                  disabled={actionLoading === `del-pitch-${d.id}`}
                  className="text-red-600 hover:text-red-800 p-1">
                  <Trash className="w-4 h-4" />
                </button>
              </div>
            </div>
          )) : <p className="text-sm text-gray-400 text-center py-8">No pitch decks yet.</p>}
        </div>
      )}

      {/* Draft create modal */}
      {draftModal && (
        <Modal open onClose={() => !submitting && setDraftModal(null)} title="New Marketing Draft">
          <div className="space-y-4">
            {formError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{formError}</div>}
            <div>
              <label className="label">Type</label>
              <select className="input" value={draftModal.draft_type}
                onChange={(e) => setDraftModal({ ...draftModal, draft_type: e.target.value })}
                disabled={submitting}>
                {DRAFT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Title <span className="text-red-500">*</span></label>
              <input className="input" value={draftModal.title}
                onChange={(e) => setDraftModal({ ...draftModal, title: e.target.value })}
                placeholder="Draft title" maxLength={500} disabled={submitting} />
            </div>
            <div>
              <label className="label">Content <span className="text-red-500">*</span></label>
              <textarea className="input" rows={6} value={draftModal.content}
                onChange={(e) => setDraftModal({ ...draftModal, content: e.target.value })}
                placeholder="Draft content (max 20000 chars)" maxLength={20000} disabled={submitting} />
            </div>
            <div>
              <label className="label">Platform</label>
              <input className="input" value={draftModal.platform || ""}
                onChange={(e) => setDraftModal({ ...draftModal, platform: e.target.value })}
                placeholder="e.g. instagram, email (optional)" maxLength={100} disabled={submitting} />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDraftModal(null)} className="btn-secondary" disabled={submitting}>Cancel</button>
              <button onClick={handleCreateDraft} className="btn-primary" disabled={submitting}>
                {submitting ? "Creating..." : "Create Draft"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Persona create modal */}
      {personaModal && (
        <Modal open onClose={() => !submitting && setPersonaModal(null)} title="New Customer Persona">
          <div className="space-y-4">
            {formError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{formError}</div>}
            <div>
              <label className="label">Name <span className="text-red-500">*</span></label>
              <input className="input" value={personaModal.name}
                onChange={(e) => setPersonaModal({ ...personaModal, name: e.target.value })}
                placeholder="e.g. Budget-Conscious SMB Owner" maxLength={200} disabled={submitting} />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea className="input" rows={2} value={personaModal.description || ""}
                onChange={(e) => setPersonaModal({ ...personaModal, description: e.target.value })}
                placeholder="Brief persona description (optional)" maxLength={5000} disabled={submitting} />
            </div>
            <div>
              <label className="label">Pain Points</label>
              <textarea className="input" rows={3} value={personaModal.pain_points || ""}
                onChange={(e) => setPersonaModal({ ...personaModal, pain_points: e.target.value })}
                placeholder="What problems do they face? (optional)" maxLength={5000} disabled={submitting} />
            </div>
            <div>
              <label className="label">Motivations</label>
              <textarea className="input" rows={3} value={personaModal.motivations || ""}
                onChange={(e) => setPersonaModal({ ...personaModal, motivations: e.target.value })}
                placeholder="What drives their decisions? (optional)" maxLength={5000} disabled={submitting} />
            </div>
            <div>
              <label className="label">Target Segment</label>
              <input className="input" value={personaModal.target_segment || ""}
                onChange={(e) => setPersonaModal({ ...personaModal, target_segment: e.target.value })}
                placeholder="e.g. SMB owners aged 25-45 (optional)" maxLength={500} disabled={submitting} />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPersonaModal(null)} className="btn-secondary" disabled={submitting}>Cancel</button>
              <button onClick={handleCreatePersona} className="btn-primary" disabled={submitting}>
                {submitting ? "Creating..." : "Create Persona"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Revise modal (shared for drafts and pitch decks) */}
      {reviseModal && (
        <Modal open onClose={() => !submitting && setReviseModal(null)} title={`Revise ${reviseModal.type === "draft" ? "Draft" : "Pitch Deck"} — ${reviseModal.title}`}>
          <div className="space-y-4">
            {formError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{formError}</div>}
            <div>
              <label className="label">Revision Instructions <span className="text-red-500">*</span></label>
              <textarea className="input" rows={4} value={reviseModal.instructions || ""}
                onChange={(e) => setReviseModal({ ...reviseModal, instructions: e.target.value })}
                placeholder="e.g. Make the tone more energetic, emphasize cost savings"
                maxLength={2000} disabled={submitting} />
              <p className="text-xs text-gray-400 mt-1">
                Uses demo AI fallback — content will be appended with a revision note. Max 2000 chars.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setReviseModal(null)} className="btn-secondary" disabled={submitting}>Cancel</button>
              <button onClick={handleRevise} className="btn-primary" disabled={submitting}>
                {submitting ? "Revising..." : "Revise [Demo]"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
