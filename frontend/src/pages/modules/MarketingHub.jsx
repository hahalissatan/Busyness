/**
 * Marketing AI — landing page for the Marketing & Pitch Deck module.
 */

import { ModulePage } from "../../components/ModulePage.jsx";

export default function MarketingHub() {
  return (
    <ModulePage
      title="Marketing AI"
      chatPlaceholder="Ask about campaigns, personas, or pitch decks…"
      features={[
        {
          icon: "🎯",
          title: "Campaign Projects",
          description:
            "Plan marketing projects with target audiences. Move them through draft, active, and completed states.",
          accent: "violet",
          to: "/marketing/projects",
        },
        {
          icon: "✨",
          title: "Content Drafts",
          description:
            "Generate draft content, persona profiles, and iterate with revisions before publishing.",
          accent: "brand",
          to: "/marketing/projects",
        },
        {
          icon: "📑",
          title: "Pitch Decks",
          description:
            "Build slide decks for each project. Generate, revise, and finalise decks with structured speaker notes.",
          accent: "amber",
          to: "/marketing/projects",
        },
      ]}
    />
  );
}