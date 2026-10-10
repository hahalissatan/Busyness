const COLORS = {
  green: "bg-green-100 text-green-800",
  blue: "bg-blue-100 text-blue-800",
  yellow: "bg-yellow-100 text-yellow-800",
  red: "bg-red-100 text-red-800",
  gray: "bg-gray-100 text-gray-800",
  purple: "bg-purple-100 text-purple-800",
  indigo: "bg-indigo-100 text-indigo-800",
};

const STATUS_MAP = {
  // Invoice
  draft: "gray", unpaid: "yellow", partially_paid: "blue", paid: "green", overdue: "red",
  // Task
  pending: "gray", in_progress: "blue", completed: "green", cancelled: "red",
  // Assignment & Marketing project (shared status)
  active: "blue", reassigned: "yellow",
  // Draft
  reviewed: "yellow", approved: "indigo", published: "green",
  // Pitch deck
  finalized: "green",
  // Priority
  low: "gray", medium: "blue", high: "yellow", urgent: "red",
};

export function Badge({ status, color, children }) {
  const c = color || STATUS_MAP[status] || "gray";
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${COLORS[c] || COLORS.gray}`}>
      {children || status?.replace(/_/g, " ")}
    </span>
  );
}
