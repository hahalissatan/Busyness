/**
 * Smoke test for Module 4: Marketing & Pitch Deck
 * Tests all 26 backend endpoints.
 *
 * Run: node smoke-test-marketing.js
 */

const BASE = "http://localhost:3001/api";

let pass = 0;
let fail = 0;
const failures = [];

function ok(msg) { pass++; console.log(`  ✓ ${msg}`); }
function bad(msg, detail) { fail++; failures.push(`${msg} — ${detail || ""}`); console.log(`  ✗ ${msg}`); if (detail) console.log(`    → ${detail}`); }

async function req(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    return { status: res.status, data, ok: res.ok };
  } catch (err) {
    return { status: 0, data: null, ok: false, error: err.message };
  }
}

async function run() {
  console.log("\n═══════════════════════════════════════");
  console.log("  Module 4: Marketing & Pitch Deck — Smoke Test");
  console.log("═══════════════════════════════════════\n");

  // ── Register ──
  console.log("─ Register demo business ─");
  const suffix = Math.random().toString(36).slice(2, 8);
  const regRes = await req("POST", "/auth/register", {
    name: "Test User",
    email: `mkt-test-${suffix}@busyness.app`,
    password: "TestPass123!",
    business_name: "Marketing Test Biz",
  });

  if (!regRes.ok || !regRes.data?.token) {
    bad("Register failed", JSON.stringify(regRes.data));
    console.log("\n Aborting — cannot continue without auth.\n");
    process.exit(1);
  }

  const token = regRes.data.token;
  const businessId = regRes.data.business.id;
  ok(`Registered: ${regRes.data.business.name} (${businessId.slice(0, 8)}…)`);
  const base = `/businesses/${businessId}/marketing`;

  // ────────────────────────────────────────
  // MARKETING PROJECTS (5 + 1 status)
  // ────────────────────────────────────────
  console.log("\n─ Marketing Projects ─");

  // POST /projects
  const projRes = await req("POST", `${base}/projects`, { name: "Q1 Launch Campaign", description: "Spring product launch" }, token);
  if (projRes.status === 201 && projRes.data?.id) { ok(`POST /projects → 201 (${projRes.data.id.slice(0, 8)}…)`); }
  else bad("POST /projects", JSON.stringify(projRes.data));
  const projectId = projRes.data?.id;

  // POST /projects — validation (empty name)
  const badProj = await req("POST", `${base}/projects`, { description: "no name" }, token);
  if (badProj.status === 400) ok("POST /projects — rejects empty name (400)");
  else bad("POST /projects — should reject empty name", `got ${badProj.status}`);

  // GET /projects
  const listRes = await req("GET", `${base}/projects`, null, token);
  if (listRes.ok && Array.isArray(listRes.data.data)) ok(`GET /projects → ${listRes.data.data.length} project(s), pagination: ${JSON.stringify(listRes.data.pagination)}`);
  else bad("GET /projects", JSON.stringify(listRes.data));

  // GET /projects?status=draft
  const filterRes = await req("GET", `${base}/projects?status=draft`, null, token);
  if (filterRes.ok && filterRes.data.data.every((p) => p.status === "draft")) ok("GET /projects?status=draft → filtered");
  else bad("GET /projects?status=draft", JSON.stringify(filterRes.data));

  // GET /projects/:projectId
  const detailRes = await req("GET", `${base}/projects/${projectId}`, null, token);
  if (detailRes.ok && detailRes.data?.id === projectId) ok(`GET /projects/:id → name=${detailRes.data.name}, personas=[], drafts=[], pitch_decks=[]`);
  else bad("GET /projects/:id", JSON.stringify(detailRes.data));

  // PATCH /projects/:projectId
  const updRes = await req("PATCH", `${base}/projects/${projectId}`, { name: "Q1 Launch — Updated", description: "Updated description" }, token);
  if (updRes.ok && updRes.data?.name === "Q1 Launch — Updated") ok("PATCH /projects/:id → name updated");
  else bad("PATCH /projects/:id", JSON.stringify(updRes.data));

  // PATCH /projects/:projectId — protected field (status)
  const badUpd = await req("PATCH", `${base}/projects/${projectId}`, { status: "active" }, token);
  if (badUpd.status === 400) ok("PATCH /projects/:id — rejects status field (400)");
  else bad("PATCH /projects/:id — should reject status", `got ${badUpd.status}`);

  // PATCH /projects/:projectId/status — draft → active
  const stRes = await req("PATCH", `${base}/projects/${projectId}/status`, { status: "active" }, token);
  if (stRes.ok && stRes.data?.status === "active") ok("PATCH /projects/:id/status → draft→active");
  else bad("PATCH /projects/:id/status draft→active", JSON.stringify(stRes.data));

  // PATCH /projects/:projectId/status — invalid transition (active → draft)
  const badTrans = await req("PATCH", `${base}/projects/${projectId}/status`, { status: "draft" }, token);
  if (badTrans.status === 400) ok("PATCH /projects/:id/status — rejects active→draft (400)");
  else bad("PATCH /projects/:id/status — should reject active→draft", `got ${badTrans.status}`);

  // ────────────────────────────────────────
  // CUSTOMER PERSONAS (6)
  // ────────────────────────────────────────
  console.log("\n─ Customer Personas ─");

  // POST /personas — manual create
  const personaRes = await req("POST", `${base}/personas`, {
    name: "Budget SMB Owner",
    description: "Cost-conscious small business owner",
    pain_points: "Limited budget, time constraints",
    motivations: "Reducing costs, saving time",
    target_segment: "SMB owners aged 25-45",
    marketing_project_id: projectId,
  }, token);
  if (personaRes.status === 201 && personaRes.data?.id) ok(`POST /personas → 201 (${personaRes.data.id.slice(0, 8)}…)`);
  else bad("POST /personas", JSON.stringify(personaRes.data));
  const personaId = personaRes.data?.id;

  // POST /personas/generate — AI persona (marketing_project_id, NOT project_id)
  const genPersona = await req("POST", `${base}/personas/generate`, { marketing_project_id: projectId }, token);
  if (genPersona.status === 201 && genPersona.data?.id) ok(`POST /personas/generate → 201, _generator=${genPersona.data._generator?.provider}`);
  else bad("POST /personas/generate", JSON.stringify(genPersona.data));
  const genPersonaId = genPersona.data?.id;

  // GET /personas
  const personaList = await req("GET", `${base}/personas?limit=100`, null, token);
  if (personaList.ok && Array.isArray(personaList.data.data)) {
    const projectPersonas = personaList.data.data.filter((p) => p.marketing_project_id === projectId);
    ok(`GET /personas → ${personaList.data.data.length} total, ${projectPersonas.length} for this project`);
  } else bad("GET /personas", JSON.stringify(personaList.data));

  // GET /personas/:personaId
  const personaDetail = await req("GET", `${base}/personas/${personaId}`, null, token);
  if (personaDetail.ok && personaDetail.data?.name === "Budget SMB Owner") ok(`GET /personas/:id → name=${personaDetail.data.name}, project_name=${personaDetail.data.project_name || "null"}`);
  else bad("GET /personas/:id", JSON.stringify(personaDetail.data));

  // PATCH /personas/:personaId
  const personaUpd = await req("PATCH", `${base}/personas/${personaId}`, { name: "Updated Persona Name" }, token);
  if (personaUpd.ok && personaUpd.data?.name === "Updated Persona Name") ok("PATCH /personas/:id → name updated");
  else bad("PATCH /personas/:id", JSON.stringify(personaUpd.data));

  // ────────────────────────────────────────
  // MARKETING DRAFTS (7)
  // ────────────────────────────────────────
  console.log("\n─ Marketing Drafts ─");

  // POST /projects/:projectId/drafts — manual create
  const draftRes = await req("POST", `${base}/projects/${projectId}/drafts`, {
    draft_type: "social_media",
    title: "Instagram Post Draft",
    content: "Check out our new product launch!",
    platform: "instagram",
  }, token);
  if (draftRes.status === 201 && draftRes.data?.id) ok(`POST /projects/:id/drafts → 201 (${draftRes.data.id.slice(0, 8)}…)`);
  else bad("POST /projects/:id/drafts", JSON.stringify(draftRes.data));
  const draftId = draftRes.data?.id;

  // POST /projects/:projectId/drafts/generate — AI draft
  const genDraft = await req("POST", `${base}/projects/${projectId}/drafts/generate`, { draft_type: "email" }, token);
  if (genDraft.status === 201 && genDraft.data?.id) ok(`POST /projects/:id/drafts/generate → 201, _generator=${genDraft.data._generator?.provider}`);
  else bad("POST /projects/:id/drafts/generate", JSON.stringify(genDraft.data));
  const genDraftId = genDraft.data?.id;

  // GET /projects/:projectId/drafts
  const draftList = await req("GET", `${base}/projects/${projectId}/drafts`, null, token);
  if (draftList.ok && Array.isArray(draftList.data.data)) ok(`GET /projects/:id/drafts → ${draftList.data.data.length} draft(s), has content field: ${!!draftList.data.data[0]?.content}`);
  else bad("GET /projects/:id/drafts", JSON.stringify(draftList.data));

  // GET /drafts/:draftId
  const draftDetail = await req("GET", `${base}/drafts/${draftId}`, null, token);
  if (draftDetail.ok && draftDetail.data?.title === "Instagram Post Draft") ok(`GET /drafts/:id → title=${draftDetail.data.title}, content present: ${!!draftDetail.data.content}`);
  else bad("GET /drafts/:id", JSON.stringify(draftDetail.data));

  // PATCH /drafts/:draftId
  const draftUpd = await req("PATCH", `${base}/drafts/${draftId}`, { title: "Updated Title" }, token);
  if (draftUpd.ok && draftUpd.data?.title === "Updated Title") ok("PATCH /drafts/:id → title updated");
  else bad("PATCH /drafts/:id", JSON.stringify(draftUpd.data));

  // PATCH /drafts/:draftId — protected field (draft_type)
  const badDraftUpd = await req("PATCH", `${base}/drafts/${draftId}`, { draft_type: "email" }, token);
  if (badDraftUpd.status === 400) ok("PATCH /drafts/:id — rejects draft_type (400)");
  else bad("PATCH /drafts/:id — should reject draft_type", `got ${badDraftUpd.status}`);

  // PATCH /drafts/:draftId/status — draft → reviewed
  const draftSt = await req("PATCH", `${base}/drafts/${draftId}/status`, { status: "reviewed" }, token);
  if (draftSt.ok && draftSt.data?.status === "reviewed") ok("PATCH /drafts/:id/status → draft→reviewed");
  else bad("PATCH /drafts/:id/status draft→reviewed", JSON.stringify(draftSt.data));

  // PATCH /drafts/:draftId/status — reviewed → approved
  const draftSt2 = await req("PATCH", `${base}/drafts/${draftId}/status`, { status: "approved" }, token);
  if (draftSt2.ok && draftSt2.data?.status === "approved") ok("PATCH /drafts/:id/status → reviewed→approved");
  else bad("PATCH /drafts/:id/status reviewed→approved", JSON.stringify(draftSt2.data));

  // POST /drafts/:draftId/revise — AI revise (instructions, plural)
  const reviseRes = await req("POST", `${base}/drafts/${draftId}/revise`, { instructions: "Make the tone more energetic" }, token);
  if (reviseRes.ok && reviseRes.data?._generator) ok(`POST /drafts/:id/revise → revised, _generator=${reviseRes.data._generator?.provider}`);
  else bad("POST /drafts/:id/revise", JSON.stringify(reviseRes.data));

  // POST /drafts/:draftId/revise — validation (empty instructions)
  const badRevise = await req("POST", `${base}/drafts/${draftId}/revise`, { instructions: "" }, token);
  if (badRevise.status === 400) ok("POST /drafts/:id/revise — rejects empty instructions (400)");
  else bad("POST /drafts/:id/revise — should reject empty instructions", `got ${badRevise.status}`);

  // ────────────────────────────────────────
  // PITCH DECKS (7)
  // ────────────────────────────────────────
  console.log("\n─ Pitch Decks ─");

  // POST /projects/:projectId/pitch-decks/generate — AI pitch deck
  const genPitch = await req("POST", `${base}/projects/${projectId}/pitch-decks/generate`, {}, token);
  if (genPitch.status === 201 && genPitch.data?.id) {
    const slideCount = Array.isArray(genPitch.data.slides) ? genPitch.data.slides.length : "N/A";
    ok(`POST /projects/:id/pitch-decks/generate → 201, slides=${slideCount}, _generator=${genPitch.data._generator?.provider}`);
  } else bad("POST /projects/:id/pitch-decks/generate", JSON.stringify(genPitch.data));
  const pitchDeckId = genPitch.data?.id;

  // POST /projects/:projectId/pitch-decks — manual create
  const pitchCreate = await req("POST", `${base}/projects/${projectId}/pitch-decks`, {
    title: "Manual Pitch Deck",
    slides: [{ slide_number: 1, heading: "Test Slide", bullet_points: ["Point 1"], speaker_notes: "Notes" }],
  }, token);
  if (pitchCreate.status === 201 && pitchCreate.data?.id) ok(`POST /projects/:id/pitch-decks → 201 (${pitchCreate.data.id.slice(0, 8)}…)`);
  else bad("POST /projects/:id/pitch-decks", JSON.stringify(pitchCreate.data));
  const manualPitchId = pitchCreate.data?.id;

  // GET /projects/:projectId/pitch-decks
  const pitchList = await req("GET", `${base}/projects/${projectId}/pitch-decks`, null, token);
  if (pitchList.ok && Array.isArray(pitchList.data.data)) {
    const hasSlides = pitchList.data.data.some((d) => Array.isArray(d.slides));
    ok(`GET /projects/:id/pitch-decks → ${pitchList.data.data.length} deck(s), has slides: ${hasSlides}`);
  } else bad("GET /projects/:id/pitch-decks", JSON.stringify(pitchList.data));

  // GET /pitch-decks/:pitchDeckId
  const pitchDetail = await req("GET", `${base}/pitch-decks/${pitchDeckId}`, null, token);
  if (pitchDetail.ok && pitchDetail.data?.title) ok(`GET /pitch-decks/:id → title=${pitchDetail.data.title}, slides: ${Array.isArray(pitchDetail.data.slides) ? pitchDetail.data.slides.length : "N/A"}`);
  else bad("GET /pitch-decks/:id", JSON.stringify(pitchDetail.data));

  // PATCH /pitch-decks/:pitchDeckId
  const pitchUpd = await req("PATCH", `${base}/pitch-decks/${manualPitchId}`, { title: "Updated Pitch Title" }, token);
  if (pitchUpd.ok && pitchUpd.data?.title === "Updated Pitch Title") ok("PATCH /pitch-decks/:id → title updated");
  else bad("PATCH /pitch-decks/:id", JSON.stringify(pitchUpd.data));

  // PATCH /pitch-decks/:pitchDeckId — protected field (status)
  const badPitchUpd = await req("PATCH", `${base}/pitch-decks/${manualPitchId}`, { status: "reviewed" }, token);
  if (badPitchUpd.status === 400) ok("PATCH /pitch-decks/:id — rejects status field (400)");
  else bad("PATCH /pitch-decks/:id — should reject status", `got ${badPitchUpd.status}`);

  // PATCH /pitch-decks/:pitchDeckId/status — draft → reviewed
  const pitchSt = await req("PATCH", `${base}/pitch-decks/${manualPitchId}/status`, { status: "reviewed" }, token);
  if (pitchSt.ok && pitchSt.data?.status === "reviewed") ok("PATCH /pitch-decks/:id/status → draft→reviewed");
  else bad("PATCH /pitch-decks/:id/status draft→reviewed", JSON.stringify(pitchSt.data));

  // PATCH /pitch-decks/:pitchDeckId/status — reviewed → finalized
  const pitchSt2 = await req("PATCH", `${base}/pitch-decks/${manualPitchId}/status`, { status: "finalized" }, token);
  if (pitchSt2.ok && pitchSt2.data?.status === "finalized") ok("PATCH /pitch-decks/:id/status → reviewed→finalized");
  else bad("PATCH /pitch-decks/:id/status reviewed→finalized", JSON.stringify(pitchSt2.data));

  // POST /pitch-decks/:pitchDeckId/revise — AI revise (instructions, plural)
  const pitchRevise = await req("POST", `${base}/pitch-decks/${pitchDeckId}/revise`, { instructions: "Add more financial details" }, token);
  if (pitchRevise.ok && pitchRevise.data?._generator) ok(`POST /pitch-decks/:id/revise → revised, _generator=${pitchRevise.data._generator?.provider}`);
  else bad("POST /pitch-decks/:id/revise", JSON.stringify(pitchRevise.data));

  // ────────────────────────────────────────
  // OVERVIEW (1)
  // ────────────────────────────────────────
  console.log("\n─ Overview ─");

  const overviewRes = await req("GET", `${base}/overview`, null, token);
  if (overviewRes.ok && overviewRes.data) {
    const d = overviewRes.data;
    ok(`GET /overview → projects=${d.total_projects}, personas=${d.total_personas}, drafts=${d.total_drafts}, pitch_decks=${d.total_pitch_decks}`);
    ok(`  Breakdown: draft_projects=${d.draft_projects}, active_projects=${d.active_projects}, completed_projects=${d.completed_projects}`);
    ok(`  Drafts: draft=${d.draft_drafts}, reviewed=${d.reviewed_drafts}, approved=${d.approved_drafts}, published=${d.published_drafts}`);
    ok(`  Pitch: draft=${d.draft_pitch_decks}, reviewed=${d.reviewed_pitch_decks}, finalized=${d.finalized_pitch_decks}`);
  } else bad("GET /overview", JSON.stringify(overviewRes.data));

  // ────────────────────────────────────────
  // DELETE (cleanup + test)
  // ────────────────────────────────────────
  console.log("\n─ Delete (cleanup) ─");

  // DELETE /drafts/:draftId
  const delDraft = await req("DELETE", `${base}/drafts/${draftId}`, null, token);
  if (delDraft.status === 204) ok("DELETE /drafts/:id → 204");
  else bad("DELETE /drafts/:id", `got ${delDraft.status}`);

  // DELETE /drafts/:genDraftId
  const delGenDraft = await req("DELETE", `${base}/drafts/${genDraftId}`, null, token);
  if (delGenDraft.status === 204) ok("DELETE /drafts/:genId → 204");
  else bad("DELETE /drafts/:genId", `got ${delGenDraft.status}`);

  // DELETE /personas/:personaId
  const delPersona = await req("DELETE", `${base}/personas/${personaId}`, null, token);
  if (delPersona.status === 204) ok("DELETE /personas/:id → 204");
  else bad("DELETE /personas/:id", `got ${delPersona.status}`);

  // DELETE /personas/:genPersonaId
  const delGenPersona = await req("DELETE", `${base}/personas/${genPersonaId}`, null, token);
  if (delGenPersona.status === 204) ok("DELETE /personas/:genId → 204");
  else bad("DELETE /personas/:genId", `got ${delGenPersona.status}`);

  // DELETE /pitch-decks/:pitchDeckId
  const delPitch = await req("DELETE", `${base}/pitch-decks/${pitchDeckId}`, null, token);
  if (delPitch.status === 204) ok("DELETE /pitch-decks/:id → 204");
  else bad("DELETE /pitch-decks/:id", `got ${delPitch.status}`);

  // DELETE /pitch-decks/:manualPitchId
  const delManualPitch = await req("DELETE", `${base}/pitch-decks/${manualPitchId}`, null, token);
  if (delManualPitch.status === 204) ok("DELETE /pitch-decks/:manualId → 204");
  else bad("DELETE /pitch-decks/:manualId", `got ${delManualPitch.status}`);

  // DELETE /projects/:projectId — should succeed now (no children)
  const delProj = await req("DELETE", `${base}/projects/${projectId}`, null, token);
  if (delProj.status === 204) ok("DELETE /projects/:id → 204 (children removed)");
  else bad("DELETE /projects/:id", `got ${delProj.status} — ${JSON.stringify(delProj.data)}`);

  // DELETE /projects/:projectId — 404 (already deleted)
  const delProj404 = await req("DELETE", `${base}/projects/${projectId}`, null, token);
  if (delProj404.status === 404) ok("DELETE /projects/:id (again) → 404");
  else bad("DELETE /projects/:id (again)", `expected 404, got ${delProj404.status}`);

  // ── Summary ──
  console.log("\n═══════════════════════════════════════");
  console.log(`  Results: ${pass} passed, ${fail} failed`);
  console.log("═══════════════════════════════════════");
  if (fail > 0) {
    console.log("\n  Failures:");
    failures.forEach((f) => console.log(`    ✗ ${f}`));
  }
  console.log("");
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
