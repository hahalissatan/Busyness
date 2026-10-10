/**
 * Task AI — landing page for the Intelligent Task Allocation module.
 */

import { ModulePage } from "../../components/ModulePage.jsx";

export default function TasksHub() {
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
    />
  );
}