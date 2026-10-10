/**
 * FeatureCard — the three empty rectangles on each module landing page.
 * Can be empty (template default), filled with a description, or clickable
 * (linking to the CRUD view for that feature).
 */

import { Link } from "react-router-dom";

export function FeatureCard({
  icon,
  title,
  description,
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
        </>
      )}
    </div>
  );

  return to ? <Link to={to} className="block">{content}</Link> : content;
}