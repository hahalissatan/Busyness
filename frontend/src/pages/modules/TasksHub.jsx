/**
 * Task AI — landing page for the Intelligent Task Allocation module.
 *
 * Enhanced with live overview data from:
 *   GET /overview — Summary stats (total_tasks, status breakdown,
 *                   priority breakdown, overdue count, active assignments)
 *
 * The overview panel renders via ModulePage's children prop.
 */

import { useState, useEffect } from "react";
import { ModulePage } from "../../components/ModulePage.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { Badge } from "../../components/ui/Badge.jsx";

function StatCard({ label, value, icon, accent = "gray", sub }) {
  const accentClasses = {
    gray: "bg-gray-50 text-gray-700",
    sky: "bg-sky-50 text-sky-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    emerald: "bg-emerald-50 text-emerald-700",
    violet: "bg-violet-50 text-violet-700",
  };

  return (
    <div className="glass-card p-4 flex items-center gap-3">
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl ${accentClasses[accent]}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{label}</p>
        <p className="text-lg font-semibold text-gray-900 dark:text-white">{value}</p>
        {sub && <p className="text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
      </div>
    </div>
  );
}

export default function TasksHub() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/tasks`;
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.get(`${base}/overview`);
        if (cancelled) return;
        setOverview(data);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load task overview.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (business?.id) fetchData();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id]);

  const overviewChildren = (
    <div className="space-y-4">
      {loading ? (
        <div className="glass-card p-6 text-center text-sm text-gray-500">Loading task overview…</div>
      ) : error ? (
        <div className="glass-card p-6 text-center text-sm text-red-600">{error}</div>
      ) : overview ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Total Tasks"
              value={overview.total_tasks ?? 0}
              icon="📋"
              accent="sky"
              sub={`${overview.pending_tasks ?? 0} pending`}
            />
            <StatCard
              label="In Progress"
              value={overview.in_progress_tasks ?? 0}
              icon="🔄"
              accent="blue"
              sub={`${overview.completed_tasks ?? 0} completed`}
            />
            <StatCard
              label="Overdue"
              value={overview.overdue_tasks ?? 0}
              icon="⚠️"
              accent={overview.overdue_tasks > 0 ? "red" : "gray"}
              sub={overview.overdue_tasks > 0 ? "Needs attention" : "All on track"}
            />
            <StatCard
              label="Active Assignments"
              value={overview.total_active_assignments ?? 0}
              icon="👥"
              accent="emerald"
              sub={`${overview.cancelled_tasks ?? 0} cancelled`}
            />
          </div>

          {/* Priority breakdown */}
          <div className="glass-card p-4">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3 text-sm">
              Priority Breakdown
            </h3>
            <div className="grid grid-cols-4 gap-3">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-700 dark:text-gray-300">
                  {overview.low_priority ?? 0}
                </div>
                <Badge color="gray">low</Badge>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-700">{overview.medium_priority ?? 0}</div>
                <Badge color="blue">medium</Badge>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-700">{overview.high_priority ?? 0}</div>
                <Badge color="yellow">high</Badge>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-700">{overview.urgent_priority ?? 0}</div>
                <Badge color="red">urgent</Badge>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );

  return (
    <ModulePage
      title="Task AI"
      module="tasks"
      chatPlaceholder="Ask about tasks, assignments, or team workload…"
      features={[
        {
          icon: "✅",
          title: "Task Management",
          description:
            "Create, assign, and track tasks with priorities and due dates. Status moves through a controlled flow.",
          accent: "emerald",
          to: "/tasks/list",
        },
        {
          icon: "👤",
          title: "Team & Skills",
          description:
            "Maintain team profiles with skills and positions. Surface workload and utilisation per member.",
          accent: "sky",
          to: "/tasks/team",
        },
        {
          icon: "📊",
          title: "Overview & Insights",
          description:
            "See counts by status and priority, overdue tasks, and active assignments at a glance.",
          accent: "violet",
          to: "/tasks/list",
        },
      ]}
    >
      {overviewChildren}
    </ModulePage>
  );
}
