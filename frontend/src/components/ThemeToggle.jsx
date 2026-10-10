/**
 * ThemeToggle — sun/moon pill switch used in landing and app header.
 */

import { useTheme } from "../context/ThemeContext.jsx";

export function ThemeToggle({ className = "" }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggleTheme}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      className={`inline-flex items-center gap-1 p-1 rounded-full glass transition-all ${className}`}
    >
      <span
        className={`w-7 h-7 rounded-full flex items-center justify-center text-sm transition-all ${
          isDark ? "bg-white/10 text-amber-300" : "text-gray-400"
        }`}
      >
        ★
      </span>
      <span
        className={`w-7 h-7 rounded-full flex items-center justify-center text-sm transition-all ${
          !isDark ? "bg-white shadow text-gray-700" : "text-gray-400"
        }`}
      >
        ☾
      </span>
    </button>
  );
}