/**
 * ThemeToggle — refined sun/moon pill switch.
 *
 * Light mode shows a filled sun icon (active).
 * Dark mode shows a filled moon icon (active).
 * The inactive icon is dimmed.
 */

import { useTheme } from "../context/ThemeContext.jsx";

function SunIcon({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.05" y2="7.05" />
      <line x1="16.95" y1="16.95" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.05" y2="16.95" />
      <line x1="16.95" y1="7.05" x2="19.07" y2="4.93" />
    </svg>
  );
}

function MoonIcon({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function ThemeToggle({ className = "" }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggleTheme}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      className={`inline-flex items-center gap-0.5 p-1 rounded-full glass transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-400/40 ${className}`}
    >
      {/* Sun — active in light mode */}
      <span
        className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300 ${
          !isDark
            ? "bg-white text-amber-500 shadow-sm"
            : "text-gray-400 dark:text-gray-500"
        }`}
      >
        <SunIcon className="w-4 h-4" />
      </span>
      {/* Moon — active in dark mode */}
      <span
        className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300 ${
          isDark
            ? "bg-white/10 text-indigo-300"
            : "text-gray-400"
        }`}
      >
        <MoonIcon className="w-4 h-4" />
      </span>
    </button>
  );
}