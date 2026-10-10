/**
 * Dashboard — aggregates overview data from all four modules.
 * Uses existing overview endpoints where available.
 * Shows loading states, empty states, and handles missing data gracefully.
 */

import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../api/client.js";
import { Spinner } from "../components/ui/Spinner.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { Link } from "react-router-dom";
import { DollarSign, Package, CheckSquare, Megaphone } from "../components/icons.jsx";

function StatCard({ icon: Icon, label, value, to, color = "brand" }) {
  const colors = {
    brand: "bg-brand-50 text-brand-700",
    green: "bg-green-50 text-green-700",
    blue: "bg-blue-50 text-blue-700",
    yellow: "bg-yellow-50 text-yellow-700",
    red: "bg-red-50 text-red-700",
  };
  return (
    <Link to={to} className="card hover:shadow-md transition-shadow">
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colors[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <p className="text-sm text-gray-500">{label}</p>
        </div>
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const { business } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!business?.id) {
      setLoading(false);
      return;
    }
    const base = `/api/businesses/${business.id}`;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [inv, invLow, tasks, mktg, invoices] = await Promise.allSettled([
          api.get(`${base}/inventory/overview`),
          api.list(`${base}/inventory/low-stock`),
          api.get(`${base}/tasks/overview`),
          api.get(`${base}/marketing/overview`),
          api.list(`${base}/financials/invoices`, { limit: 5 }),
        ]);

        setData({
          inventory: inv.status === "fulfilled" ? inv.value : null,
          lowStock: invLow.status === "fulfilled" ? invLow.value.data : [],
          tasks: tasks.status === "fulfilled" ? tasks.value : null,
          marketing: mktg.status === "fulfilled" ? mktg.value : null,
          recentInvoices: invoices.status === "fulfilled" ? invoices.value.data : [],
        });
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [business?.id]);

  if (loading) return <div className="py-16 flex justify-center"><Spinner size="lg" /></div>;
  if (error) return <div className="card"><p className="text-red-600">{error}</p></div>;
  if (!business?.id) {
    return (
      <div className="card text-center py-12">
        <p className="text-gray-500">No business selected. Please contact an administrator or create a business.</p>
      </div>
    );
  }

  const inv = data?.inventory;
  const tasks = data?.tasks;
  const mktg = data?.marketing;

  // Build task status counts from flat API response
  const taskStatuses = tasks
    ? [
        { status: "pending", count: tasks.pending_tasks ?? 0 },
        { status: "in_progress", count: tasks.in_progress_tasks ?? 0 },
        { status: "completed", count: tasks.completed_tasks ?? 0 },
        { status: "cancelled", count: tasks.cancelled_tasks ?? 0 },
      ]
    : [];

  const openTasks = tasks
    ? (tasks.pending_tasks ?? 0) + (tasks.in_progress_tasks ?? 0)
    : "—";

  const totalProjects = mktg?.total_projects ?? "—";

  return (
    <div className="space-y-6">
      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={DollarSign} label="Total Invoices" value={data?.recentInvoices?.length || 0} to="/financials/invoices" color="brand" />
        <StatCard icon={Package} label="Products" value={inv?.total_products ?? "—"} to="/inventory/products" color="blue" />
        <StatCard icon={CheckSquare} label="Open Tasks" value={openTasks} to="/tasks" color="yellow" />
        <StatCard icon={Megaphone} label="Marketing Projects" value={totalProjects} to="/marketing/projects" color="green" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Low stock alert */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Low Stock Alerts</h2>
          {data?.lowStock?.length ? (
            <div className="space-y-2">
              {data.lowStock.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <span className="text-sm font-medium">{p.name}</span>
                  <Badge color="red">Stock: {p.stock_quantity} / Reorder: {p.reorder_threshold}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">All products are well stocked.</p>
          )}
        </div>

        {/* Task overview */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Task Overview</h2>
          {taskStatuses.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {taskStatuses.map(({ status, count }) => (
                <div key={status} className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                  <Badge status={status} />
                  <span className="text-lg font-bold">{count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">Task overview unavailable.</p>
          )}
        </div>

        {/* Recent invoices */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Recent Invoices</h2>
          {data?.recentInvoices?.length ? (
            <div className="space-y-2">
              {data.recentInvoices.map((inv) => (
                <Link key={inv.id} to={`/financials/invoices/${inv.id}`} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded">
                  <span className="text-sm font-medium truncate">{inv.customer_name || "—"}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">RM {(inv.total || 0).toFixed(2)}</span>
                    <Badge status={inv.status} />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No invoices yet.</p>
          )}
        </div>

        {/* Inventory value */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Inventory Summary</h2>
          {inv ? (
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Total Products</span>
                <span className="font-semibold">{inv.total_products}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Total Stock Value</span>
                <span className="font-semibold">RM {(inv.total_stock_value || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Low Stock Items</span>
                <span className="font-semibold text-red-600">{inv.low_stock_count}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Inventory overview unavailable.</p>
          )}
        </div>
      </div>
    </div>
  );
}
