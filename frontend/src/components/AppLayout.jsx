/**
 * AppLayout — main application shell matching the template.
 *
 * Structure:
 *   - Top header: logo, breadcrumb, theme toggle
 *   - Left sidebar: store name input, workspace nav, owner name
 *   - Main content: children
 *
 * Responsive: sidebar collapses on small screens (toggled by hamburger).
 */

import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "./Logo.jsx";
import { ThemeToggle } from "./ThemeToggle.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { useWorkspace } from "../context/WorkspaceContext.jsx";
import { Menu, X, Briefcase, DollarSign, Package, CheckSquare, Megaphone } from "./icons.jsx";

const NAV = [
  { to: "/financial", label: "Financial", icon: DollarSign, accent: "amber" },
  { to: "/inventory", label: "Inventory", icon: Package, accent: "sky" },
  { to: "/tasks", label: "Task Allocation", icon: CheckSquare, accent: "emerald" },
  { to: "/marketing", label: "Marketing", icon: Megaphone, accent: "violet" },
];

const ACCENT_CLASSES = {
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
};

function Breadcrumb() {
  const { pathname } = useLocation();
  const match = NAV.find((n) => pathname.startsWith(n.to));
  const label = match?.label ?? "Workspace";
  return (
    <div className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2">
      <span className="text-gray-500 dark:text-gray-400">Workspace</span>
      <span className="text-gray-400 dark:text-gray-500">›</span>
      <span className="font-medium text-gray-900 dark:text-white">{label}</span>
    </div>
  );
}

export default function AppLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme } = useTheme();
  const { storeName, setStoreName, ownerName } = useWorkspace();
  const navigate = useNavigate();
  const isDark = theme === "dark";

  return (
    <div
      className={`min-h-screen relative overflow-hidden ${
        isDark ? "bg-app-dark" : "bg-app-light"
      }`}
    >
      {/* Background bokeh */}
      <div className={`bokeh w-96 h-96 -top-20 -left-20 ${isDark ? "bg-sky-400/10" : "bg-sky-200/30"} blur-3xl`} />
      <div className={`bokeh w-80 h-80 bottom-0 right-0 ${isDark ? "bg-amber-400/10" : "bg-amber-200/25"} blur-3xl`} />

      {/* Top header */}
      <header className="relative z-20 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden p-2 rounded-lg hover:bg-white/40 dark:hover:bg-white/10"
            aria-label="Toggle menu"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2"
            aria-label="Busyness home"
          >
            <Logo size="sm" />
          </button>
        </div>
        <div className="hidden md:block">
          <Breadcrumb />
        </div>
        <ThemeToggle />
      </header>

      <div className="relative z-10 flex">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/30 z-30 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          } md:translate-x-0 fixed md:sticky top-0 md:top-[68px] left-0 h-screen md:h-[calc(100vh-68px)] w-64 z-40 md:z-10 transition-transform duration-300 px-4 py-6 overflow-y-auto`}
        >
          <div className="flex flex-col h-full">
            {/* Store name card */}
            <div className="glass-card p-4 mb-6">
              <div className="flex items-center gap-2 mb-2">
                <Briefcase className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                <span className="text-[10px] tracking-[0.2em] uppercase text-gray-500 dark:text-gray-400">
                  Store
                </span>
              </div>
              <input
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="Name of the store"
                className="w-full bg-transparent text-sm font-medium text-gray-900 dark:text-white placeholder:text-gray-400 outline-none"
              />
            </div>

            {/* Workspace nav */}
            <div className="mb-4">
              <p className="text-[10px] tracking-[0.25em] uppercase text-gray-500 dark:text-gray-400 mb-3 px-2 font-semibold">
                Workspace
              </p>
              <nav className="space-y-1">
                {NAV.map(({ to, label, icon: Icon, accent }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      `nav-item ${isActive ? "nav-item-active" : ""}`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                            isActive
                              ? ACCENT_CLASSES[accent]
                              : "bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400"
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                        </span>
                        {label}
                      </>
                    )}
                  </NavLink>
                ))}
              </nav>
            </div>

            <div className="flex-1" />

            {/* Owner */}
            <div className="glass-card p-3 mt-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-violet-500 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                  {ownerName?.[0]?.toUpperCase() || "U"}
                </div>
                <input
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="Name of the owner"
                  className="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-200 placeholder:text-gray-400 outline-none min-w-0"
                />
              </div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 px-4 md:px-8 pb-8 pt-2">
          <div className="md:hidden mb-4">
            <Breadcrumb />
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}