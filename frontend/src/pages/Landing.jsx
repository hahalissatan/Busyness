/**
 * Landing — full-screen welcome screen with "GET STARTED" CTA.
 * Replaces the login page. No auth required — pressing the button
 * drops the user straight into the workspace.
 *
 * Design tokens follow the provided template:
 *   - BUSYNESS wordmark centered, with floating decorative cards
 *   - Tagline + WELCOME label + pill CTA + hint text
 *   - Theme toggle in top-right
 *   - Press Enter or click to continue
 */

import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Logo } from "../components/Logo.jsx";
import { ThemeToggle } from "../components/ThemeToggle.jsx";
import { useTheme } from "../context/ThemeContext.jsx";

function FloatingCard({ icon, className, rotate = 0 }) {
  return (
    <div
      className={`absolute glass-strong rounded-2xl p-4 w-20 h-24 flex items-center justify-center text-3xl animate-float ${className}`}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      {icon}
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const enter = () => navigate("/inventory");

  // Keyboard shortcut: Enter to start
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Enter") enter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`min-h-screen relative overflow-hidden ${
        isDark ? "bg-landing-dark" : "bg-landing-light"
      }`}
    >
      {/* Bokeh circles */}
      <div className={`bokeh w-72 h-72 top-[-4rem] left-[-4rem] ${isDark ? "bg-cyan-400/10" : "bg-sky-300/40"} blur-3xl`} />
      <div className={`bokeh w-96 h-96 bottom-[-6rem] right-[-6rem] ${isDark ? "bg-teal-400/10" : "bg-emerald-300/30"} blur-3xl`} />
      <div className={`bokeh w-64 h-64 top-1/3 right-1/4 ${isDark ? "bg-violet-400/10" : "bg-pink-200/40"} blur-3xl`} />

      {/* Floating decorative cards */}
      <FloatingCard icon="📊" className="top-20 left-12 animate-float-slow hidden md:flex" rotate={-8} />
      <FloatingCard icon="📅" className="bottom-32 right-16 animate-float-slower hidden md:flex" rotate={6} />
      <FloatingCard icon="💬" className="top-32 right-24 animate-float hidden md:flex" rotate={4} />
      <FloatingCard icon="📈" className="bottom-20 left-24 animate-float-slow hidden md:flex" rotate={-4} />

      {/* Top bar */}
      <div className="absolute top-6 right-6 z-10">
        <ThemeToggle />
      </div>

      {/* Center content */}
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <h1 className="font-display text-gray-900 dark:text-white animate-fade-in">
          <Logo size="xl" />
        </h1>
        <p className="mt-4 text-base md:text-lg text-gray-700 dark:text-gray-300 animate-fade-in">
          Turn Busyness into Business
        </p>

        <div className="mt-16 animate-fade-in">
          <p className="text-xs tracking-[0.3em] uppercase text-gray-500 dark:text-gray-400 mb-5">
            Welcome to Busyness
          </p>
          <button
            onClick={enter}
            className="cta-pill"
          >
            {isDark ? "ENTER WORKSPACE" : "GET STARTED"}
            <span className="text-lg">→</span>
          </button>
          <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">
            {isDark ? "Press Enter to start" : "Swipe to continue"}
          </p>
        </div>
      </div>
    </div>
  );
}