/**
 * Task AI — landing page for the Intelligent Task Allocation module.
 *
 * Minimal three-card layout with compact live indicators from:
 *   GET /overview — total_tasks, overdue_tasks, total_active_assignments
 *
 * Removed: 4 stat cards, priority breakdown panel, StatCard helper.
 * Kept: ChatInput (text + voice + file), three feature cards.
 */

import { useState, useEffect } from "react";
import { ModulePage } from "../../components/ModulePage.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";

export default function TasksHub() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/tasks`;
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
  const tasksBadge = loading
    ? null
    : `${overview?.total_tasks ?? 0} total · ${overview?.overdue_tasks ?? 0} overdue`;

  const workloadBadge = loading
    ? null
    : `${overview?.total_active_assignments ?? 0} active assignments`;

  return (
    <ModulePage
      title="Task AI"
      module="tasks"
      chatPlaceholder="Ask about tasks, assignments, or team workload…"
      features={[
        {
          icon: "✅",
          title: "Tasks",
          description: "Create, organize, and track tasks with priorities and deadlines.",
          accent: "emerald",
          to: "/tasks/list",
          badge: tasksBadge,
        },
        {
          icon: "👤",
          title: "Team Members",
          description: "Manage team members, roles, skills, and availability.",
          accent: "sky",
          to: "/tasks/team",
        },
        {
          icon: "📊",
          title: "Workload & Assignments",
          description: "Review active assignments and team workload utilisation.",
          accent: "violet",
          to: "/tasks/team",
          badge: workloadBadge,
        },
      ]}
    />
  );
}
