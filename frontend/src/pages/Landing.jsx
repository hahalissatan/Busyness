/**
 * Landing — premium welcome screen for BUSYNESS.
 *
 * Design principles:
 *   - Clean wordmark as the central visual focus
 *   - Subtle teal accent on the "Y" for brand recognition
 *   - Soft ambient background with restrained colour glows
 *   - Four floating feature icons (real BUSYNESS modules, not emoji)
 *   - "Get started →" pill button with dark charcoal background
 *   - Theme toggle (sun/moon) in top-right
 *   - Press Enter or click to enter the workspace
 *   - Respect prefers-reduced-motion (handled in CSS)
 *   - Responsive: icons hidden on mobile, typography scales
 */

import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Logo } from "../components/Logo.jsx";
import { ThemeToggle } from "../components/ThemeToggle.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { DollarSign, Package, CheckSquare, Megaphone } from "../components/icons.jsx";

/**
 * FloatingIcon — a single decorative feature icon in a glass tile.
 * Placed around the hero composition. Hidden on small screens.
 * aria-hidden because these are decorative, not interactive.
 */
function FloatingIcon({ icon: Icon, label, className, delay = "0s", tint = "teal" }) {
  const tints = {
    teal: "text-teal-500 dark:text-teal-400",
    amber: "text-amber-500 dark:text-amber-400",
    sky: "text-sky-500 dark:text-sky-400",
    violet: "text-violet-500 dark:text-violet-400",
  };

  return (
    <div
      aria-hidden="true"
      className={`icon-tile absolute w-16 h-16 md:w-20 md:h-20 animate-float hidden md:flex ${className}`}
      style={{ animationDelay: delay }}
    >
      <Icon className={`w-7 h-7 md:w-8 md:h-8 ${tints[tint]}`} />
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
      {/* Ambient colour glows — soft, restrained */}
      <div
        className="bokeh w-[28rem] h-[28rem] -top-32 -left-32 blur-3xl"
        style={{ background: isDark ? "rgba(56,189,248,0.06)" : "rgba(186,230,253,0.3)" }}
      />
      <div
        className="bokeh w-[32rem] h-[32rem] -bottom-40 -right-40 blur-3xl"
        style={{ background: isDark ? "rgba(45,212,191,0.05)" : "rgba(167,243,208,0.2)" }}
      />

      {/* Floating feature icons — positioned around the hero */}
      <FloatingIcon
        icon={DollarSign}
        label="Financial"
        tint="amber"
        className="top-[18%] left-[10%]"
        delay="0s"
      />
      <FloatingIcon
        icon={Package}
        label="Inventory"
        tint="sky"
        className="top-[22%] right-[12%]"
        delay="1.5s"
      />
      <FloatingIcon
        icon={CheckSquare}
        label="Tasks"
        tint="teal"
        className="bottom-[20%] left-[14%]"
        delay="0.8s"
      />
      <FloatingIcon
        icon={Megaphone}
        label="Marketing"
        tint="violet"
        className="bottom-[22%] right-[10%]"
        delay="2.2s"
      />

      {/* Theme toggle — top right */}
      <div className="absolute top-6 right-6 z-20">
        <ThemeToggle />
      </div>

      {/* Center content */}
      <main className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 text-center">
        {/* Wordmark */}
        <h1 className="animate-fade-in select-none">
          <Logo size="xl" />
        </h1>

        {/* Tagline */}
        <p className="mt-5 text-base md:text-lg text-gray-600 dark:text-gray-300 font-medium animate-fade-in">
          Turn Busyness into Business
        </p>

        {/* CTA section */}
        <div className="mt-14 animate-fade-in">
          <p className="text-[11px] tracking-[0.25em] uppercase text-gray-400 dark:text-gray-500 mb-6 font-medium">
            Welcome to Busyness
          </p>
          <button
            onClick={enter}
            className="cta-pill"
            aria-label="Get started — enter the Busyness workspace"
          >
            Get started
            <span className="text-lg leading-none">→</span>
          </button>
          <p className="mt-7 text-sm text-gray-400 dark:text-gray-500">
            A clearer way to move forward
          </p>
        </div>
      </main>
    </div>
  );
}