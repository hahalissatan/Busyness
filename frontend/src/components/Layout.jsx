/**
 * Layout — application shell with responsive sidebar and topbar.
 * Sidebar collapses on mobile via a hamburger toggle.
 */

import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { Home, DollarSign, Package, CheckSquare, Megaphone, Users, LogOut, Menu, X } from "./icons.jsx";

const NAV = [
  { to: "/", label: "Dashboard", icon: Home },
  { to: "/financials/customers", label: "Financial Hub", icon: DollarSign },
  { to: "/inventory/products", label: "Inventory", icon: Package },
  { to: "/tasks", label: "Task Allocation", icon: CheckSquare },
  { to: "/marketing/projects", label: "Marketing", icon: Megaphone },
];

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, business, businesses, logout, switchBusiness } = useAuth();
  const location = useLocation();

  const currentNav = NAV.find((n) => location.pathname.startsWith(n.to) && n.to !== "/") || NAV[0];

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:sticky top-0 left-0 h-screen w-64 bg-brand-900 text-white flex flex-col z-40 transition-transform ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        <div className="px-6 py-5 border-b border-brand-800">
          <div className="flex items-center gap-2">
            <span className="text-2xl">💼</span>
            <span className="text-xl font-bold">Busyness</span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? "bg-brand-700 text-white" : "text-brand-200 hover:bg-brand-800 hover:text-white"
                }`
              }
            >
              <Icon className="w-5 h-5" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Business switcher + user */}
        <div className="px-3 py-4 border-t border-brand-800 space-y-2">
          {businesses.length > 1 && (
            <select
              value={business?.id || ""}
              onChange={(e) => {
                const biz = businesses.find((b) => b.id === e.target.value);
                if (biz) switchBusiness(biz);
              }}
              className="w-full px-2 py-1.5 rounded-lg bg-brand-800 text-white text-xs border border-brand-700"
            >
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-2 px-3">
            <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-sm font-semibold">
              {user?.name?.[0]?.toUpperCase() || "U"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name}</p>
              <p className="text-xs text-brand-300 truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 px-3 py-2 w-full rounded-lg text-sm text-brand-200 hover:bg-brand-800 hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 lg:px-6 py-3 flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <h1 className="text-lg font-semibold text-gray-900 flex-1">
            {currentNav.label}
          </h1>
          {business && (
            <span className="hidden sm:inline-block text-sm text-gray-500">
              {business.name}
            </span>
          )}
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6 overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
