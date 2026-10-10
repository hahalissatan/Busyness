/**
 * ProjectDetail — personas, drafts, pitch decks with AI generation (demo).
 * Shows [Demo] badge for AI-generated content.
 */

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { ChevronLeft, Plus } from "../../components/icons.jsx";

export default function ProjectDetail() {
  const { id } = useParams();
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/marketing`;
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("drafts");
  const [genLoading, setGenLoading] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`${base}/projects/${id}`);
      setProject(res);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // Persona generation
  const generatePersona = async () => {
    setGenLoading("persona");
    try {
      await api.post(`${base}/personas/generate`, { project_id: id });
      load();
    } catch (err) { alert(err.message); }
    finally { setGenLoading(null); }
  };

  // Draft generation
  const generateDraft = async () => {
    setGenLoading("draft");
    try {
      await api.post(`${base}/projects/${id}/drafts/generate`, { draft_type: "social_media" });
      load();
    } catch (err) { alert(err.message); }
    finally { setGenLoading(null); }
  };

  // Pitch deck generation
  const generatePitchDeck = async () => {
    setGenLoading("pitch");
    try {
      await api.post(`${base}/projects/${id}/pitch-decks/generate`, {});
      load();
    } catch (err) { alert(err.message); }
    finally { setGenLoading(null); }
  };

  // Draft status transition
  const updateDraftStatus = async (draftId, newStatus) => {
    try { await api.patch(`${base}/drafts/${draftId}/status`, { status: newStatus }); load(); }
    catch (err) { alert(err.message); }
  };

  // Pitch deck status transition
  const updatePitchStatus = async (deckId, newStatus) => {
    try { await api.patch(`${base}/pitch-decks/${deckId}/status`, { status: newStatus }); load(); }
    catch (err) { alert(err.message); }
  };

  // Revise draft
  const reviseDraft = async (draftId) => {
    try { await api.post(`${base}/drafts/${draftId}/revise`, { instruction: "Improve clarity" }); load(); }
    catch (err) { alert(err.message); }
  };

  if (loading) return <Spinner size="lg" />;
  if (error) return <div className="card text-red-600">{error}</div>;
  if (!project) return <div className="card">Project not found.</div>;

  const tabs = [
    { key: "drafts", label: "Drafts", count: project.drafts?.length || 0 },
    { key: "personas", label: "Personas", count: project.personas?.length || 0 },
    { key: "pitch", label: "Pitch Decks", count: project.pitch_decks?.length || 0 },
  ];

  return (
    <div className="space-y-6">
      <Link to="/marketing/projects" className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
        <ChevronLeft className="w-4 h-4" /> Back to projects
      </Link>

      <div className="card">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold">{project.name}</h2>
            <p className="text-sm text-gray-500 mt-1">{project.description}</p>
            {project.target_audience && <p className="text-sm text-gray-400 mt-1">Audience: {project.target_audience}</p>}
          </div>
          <Badge status={project.status} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? "border-brand-600 text-brand-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {/* Drafts */}
      {tab === "drafts" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={generateDraft} disabled={genLoading === "draft"} className="btn-primary">
              {genLoading === "draft" ? "Generating..." : "Generate Draft [Demo]"}
            </button>
          </div>
          {project.drafts?.length ? project.drafts.map((d) => (
            <div key={d.id} className="card">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className="font-medium">{d.title}</span>
                  <span className="ml-2 text-xs text-gray-400">{d.draft_type}</span>
                </div>
                <Badge status={d.status} />
              </div>
              <p className="text-sm text-gray-600 whitespace-pre-wrap mb-2">{d.content || "(empty)"}</p>
              {d._generator?.provider === "demo" && <Badge color="purple">Demo Generated</Badge>}
              <div className="flex gap-2 mt-3">
                {d.status === "draft" && <button onClick={() => updateDraftStatus(d.id, "reviewed")} className="btn-secondary !py-1">Mark Reviewed</button>}
                {d.status === "reviewed" && <button onClick={() => updateDraftStatus(d.id, "approved")} className="btn-secondary !py-1">Approve</button>}
                {d.status === "approved" && <button onClick={() => updateDraftStatus(d.id, "published")} className="btn-secondary !py-1">Publish</button>}
                <button onClick={() => reviseDraft(d.id)} className="btn-secondary !py-1">Revise [Demo]</button>
              </div>
            </div>
          )) : <p className="text-sm text-gray-400 text-center py-8">No drafts yet. Generate one or create manually.</p>}
        </div>
      )}

      {/* Personas */}
      {tab === "personas" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={generatePersona} disabled={genLoading === "persona"} className="btn-primary">
              {genLoading === "persona" ? "Generating..." : "Generate Persona [Demo]"}
            </button>
          </div>
          {project.personas?.length ? project.personas.map((p) => (
            <div key={p.id} className="card">
              <div className="flex items-start justify-between mb-2">
                <span className="font-medium">{p.name}</span>
                {p._generator?.provider === "demo" && <Badge color="purple">Demo Generated</Badge>}
              </div>
              <div className="text-sm text-gray-600 space-y-1">
                {p.demographics && <p><span className="text-gray-400">Demographics:</span> {typeof p.demographics === "string" ? p.demographics : JSON.stringify(p.demographics)}</p>}
                {p.pain_points && <p><span className="text-gray-400">Pain points:</span> {p.pain_points}</p>}
                {p.goals && <p><span className="text-gray-400">Goals:</span> {p.goals}</p>}
              </div>
            </div>
          )) : <p className="text-sm text-gray-400 text-center py-8">No personas yet.</p>}
        </div>
      )}

      {/* Pitch Decks */}
      {tab === "pitch" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={generatePitchDeck} disabled={genLoading === "pitch"} className="btn-primary">
              {genLoading === "pitch" ? "Generating..." : "Generate Pitch Deck [Demo]"}
            </button>
          </div>
          {project.pitch_decks?.length ? project.pitch_decks.map((d) => (
            <div key={d.id} className="card">
              <div className="flex items-start justify-between mb-2">
                <span className="font-medium">{d.title}</span>
                <Badge status={d.status} />
              </div>
              {d._generator?.provider === "demo" && <Badge color="purple">Demo Generated</Badge>}
              {d.slides && d.slides.length > 0 && (
                <div className="mt-3 space-y-2">
                  {d.slides.map((slide, i) => (
                    <div key={i} className="p-3 rounded-lg bg-gray-50">
                      <p className="text-sm font-medium">Slide {slide.slide_number}: {slide.heading}</p>
                      {slide.bullet_points && <ul className="text-xs text-gray-500 mt-1 ml-4 list-disc">{slide.bullet_points.map((b, j) => <li key={j}>{b}</li>)}</ul>}
                      {slide.speaker_notes && <p className="text-xs text-gray-400 mt-1 italic">{slide.speaker_notes}</p>}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 mt-3">
                {d.status === "draft" && <button onClick={() => updatePitchStatus(d.id, "reviewed")} className="btn-secondary !py-1">Mark Reviewed</button>}
                {d.status === "reviewed" && <button onClick={() => updatePitchStatus(d.id, "finalized")} className="btn-secondary !py-1">Finalize</button>}
                <button onClick={async () => { try { await api.post(`${base}/pitch-decks/${d.id}/revise`, { instruction: "Improve" }); load(); } catch (err) { alert(err.message); } }} className="btn-secondary !py-1">Revise [Demo]</button>
              </div>
            </div>
          )) : <p className="text-sm text-gray-400 text-center py-8">No pitch decks yet.</p>}
        </div>
      )}
    </div>
  );
}
