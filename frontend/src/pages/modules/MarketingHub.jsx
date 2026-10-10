/**
 * Marketing AI — landing page for the Marketing & Pitch Deck module.
 *
 * Minimal three-card layout with compact live indicators from:
 *   GET /overview — active_projects, total_drafts, total_pitch_decks
 *
 * Removed: 4 stat cards, draft pipeline breakdown, project status breakdown.
 * Kept: ChatInput (text + voice + file), three feature cards.
 *
 * Note: Personas, drafts, and pitch decks are managed within project detail
 * pages (/marketing/projects/:id). There is no separate listing route for
 * these resources, so cards link to /marketing/projects.
 */

import { useState, useEffect } from "react";
import { ModulePage } from "../../components/ModulePage.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";

export default function MarketingHub() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/marketing`;
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get(`${base}/overview`);
        if (!cancelled) setOverview(data);
      } catch {
        /* overview is optional — fail silently */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  // Compact live badges from overview data
  const projectsBadge = loading
    ? null
    : `${overview?.active_projects ?? 0} active`;

  const draftsBadge = loading
    ? null
    : `${overview?.total_drafts ?? 0} drafts`;

  const pitchBadge = loading
    ? null
    : `${overview?.total_pitch_decks ?? 0} decks`;

  return (
    <ModulePage
      title="Marketing AI"
      module="marketing"
      chatPlaceholder="Ask about campaigns, personas, or pitch decks…"
      features={[
        {
          icon: "🎯",
          title: "Marketing Projects",
          description: "Plan and manage marketing projects from draft to completion.",
          accent: "violet",
          to: "/marketing/projects",
          badge: projectsBadge,
        },
        {
          icon: "✨",
          title: "Content & Personas",
          description: "Build audience personas and manage marketing drafts within each project.",
          accent: "brand",
          to: "/marketing/projects",
          badge: draftsBadge,
        },
        {
          icon: "📑",
          title: "Pitch Decks",
          description: "Create, review, and finalise pitch decks with structured slides.",
          accent: "amber",
          to: "/marketing/projects",
          badge: pitchBadge,
        },
      ]}
    />
  );
}
