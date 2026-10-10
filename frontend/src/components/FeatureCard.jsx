/**
 * FeatureCard — the three rectangles on each module landing page.
 *
 * Props:
 *   icon        — Emoji or SVG icon (optional)
 *   title       — Card heading (optional)
 *   description — Body text (optional)
 *   badge       — Small live indicator pill below description (optional, string or node)
 *   to          — Route to navigate to on click (optional; if absent, card is non-clickable)
 *   accent      — Gradient color for icon background: "brand" | "amber" | "sky" | "emerald" | "violet"
 *   empty       — Render as empty placeholder (template default state)
 *
 * Backward compatible: FinancialHub and InventoryHub don't pass `badge`,
 * so they render exactly as before.
 */

import { Link } from "react-router-dom";

export function FeatureCard({
  icon,
  title,
  description,
  badge,
  to,
  accent = "brand",
  empty = false,
}) {
  const accents = {
    brand: "from-brand-400/20 to-violet-400/20 text-brand-700 dark:text-brand-300",
    amber: "from-amber-400/20 to-orange-400/20 text-amber-700 dark:text-amber-300",
    sky: "from-sky-400/20 to-cyan-400/20 text-sky-700 dark:text-sky-300",
    emerald: "from-emerald-400/20 to-teal-400/20 text-emerald-700 dark:text-emerald-300",
    violet: "from-violet-400/20 to-fuchsia-400/20 text-violet-700 dark:text-violet-300",
  };

  const content = (
    <div
      className={`glass-card relative h-64 md:h-72 p-6 flex flex-col group transition-all duration-300 ${
        to ? "hover:scale-[1.02] hover:shadow-xl cursor-pointer" : ""
      }`}
    >
      {empty ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full border-2 border-dashed border-gray-300 dark:border-white/20" />
        </div>
      ) : (
        <>
          {icon && (
            <div
              className={`w-12 h-12 rounded-xl bg-gradient-to-br ${accents[accent]} flex items-center justify-center text-2xl mb-4`}
            >
              {icon}
            </div>
          )}
          {title && (
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              {title}
            </h3>
          )}
          {description && (
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed flex-1">
              {description}
            </p>
          )}
          {badge && (
            <div className="mt-3">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300">
                {badge}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );

  return to ? <Link to={to} className="block">{content}</Link> : content;
}
