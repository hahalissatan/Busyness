/**
 * Inventory AI — landing page for the Smart Stock & Inventory module.
 *
 * Enhanced with live overview data from:
 *   GET /overview    — Summary stats (total products, stock value, low-stock count, etc.)
 *   GET /low-stock   — Products at or below min_stock_threshold
 *
 * The overview panel renders via ModulePage's children prop, placed between
 * the feature cards and the chat input.
 */

import { useState, useEffect } from "react";
import { ModulePage } from "../../components/ModulePage.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { Badge } from "../../components/ui/Badge.jsx";

function StatCard({ label, value, icon, accent = "gray", sub }) {
  const accentClasses = {
    gray: "bg-gray-50 text-gray-700",
    sky: "bg-sky-50 text-sky-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    emerald: "bg-emerald-50 text-emerald-700",
    violet: "bg-violet-50 text-violet-700",
  };

  return (
    <div className="glass-card p-4 flex items-center gap-3">
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl ${accentClasses[accent]}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{label}</p>
        <p className="text-lg font-semibold text-gray-900 dark:text-white">{value}</p>
        {sub && <p className="text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
      </div>
    </div>
  );
}

export default function InventoryHub() {
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/inventory`;
  const [overview, setOverview] = useState(null);
  const [lowStock, setLowStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [overviewRes, lowStockRes] = await Promise.all([
          api.get(`${base}/overview`),
          api.list(`${base}/low-stock`, { limit: 100 }),
        ]);
        if (cancelled) return;
        setOverview(overviewRes);
        setLowStock(lowStockRes.data || []);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load inventory overview.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (business?.id) fetchData();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id]);

  const overviewChildren = (
    <div className="space-y-4">
      {/* Overview stats */}
      {loading ? (
        <div className="glass-card p-6 text-center text-sm text-gray-500">Loading inventory overview…</div>
      ) : error ? (
        <div className="glass-card p-6 text-center text-sm text-red-600">{error}</div>
      ) : overview ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Total Products"
              value={overview.total_products ?? 0}
              icon="📦"
              accent="sky"
              sub={`${overview.active_products ?? 0} active, ${overview.inactive_products ?? 0} inactive`}
            />
            <StatCard
              label="Stock Value"
              value={`RM ${parseFloat(overview.total_stock_value || 0).toFixed(2)}`}
              icon="💰"
              accent="emerald"
              sub={`${parseFloat(overview.total_stock_units || 0).toLocaleString()} units total`}
            />
            <StatCard
              label="Low Stock Items"
              value={overview.low_stock_count ?? 0}
              icon="⚠️"
              accent={overview.low_stock_count > 0 ? "red" : "gray"}
              sub={overview.low_stock_count > 0 ? "Needs reorder" : "All above threshold"}
            />
            <StatCard
              label="Near Expiry"
              value={overview.near_expiry_count ?? 0}
              icon="📅"
              accent={overview.near_expiry_count > 0 ? "amber" : "gray"}
              sub="Within 7 days"
            />
          </div>

          {/* Low-stock alerts */}
          {lowStock.length > 0 && (
            <div className="glass-card overflow-hidden p-0">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-white/10">
                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <span className="text-red-500">⚠️</span>
                  Low Stock Alerts
                  <Badge color="red">{lowStock.length}</Badge>
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-white/5">
                    <tr>
                      <th className="table-header">Product</th>
                      <th className="table-header">SKU</th>
                      <th className="table-header">Current</th>
                      <th className="table-header">Threshold</th>
                      <th className="table-header">Shortfall</th>
                      <th className="table-header">Supplier</th>
                      <th className="table-header">Stock Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStock.map((p) => (
                      <tr key={p.id} className="table-row">
                        <td className="table-cell font-medium">{p.name}</td>
                        <td className="table-cell">{p.sku}</td>
                        <td className="table-cell">
                          <span className="text-red-600 font-bold">{p.stock_quantity}</span>
                        </td>
                        <td className="table-cell">{p.min_stock_threshold}</td>
                        <td className="table-cell">
                          {parseFloat(p.shortfall) > 0 ? (
                            <Badge color="red">−{p.shortfall}</Badge>
                          ) : (
                            <Badge color="amber">At threshold</Badge>
                          )}
                        </td>
                        <td className="table-cell">{p.supplier_name || "—"}</td>
                        <td className="table-cell">
                          {p.stock_value ? `RM ${parseFloat(p.stock_value).toFixed(2)}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );

  return (
    <ModulePage
      title="Inventory AI"
      module="inventory"
      chatPlaceholder="Ask about stock, suppliers, or reorder points…"
      features={[
        {
          icon: "📦",
          title: "Stock Movements",
          description:
            "Record purchases, sales, and write-offs. Stock levels update atomically and never go negative.",
          accent: "sky",
          to: "/inventory/movements",
        },
        {
          icon: "🏷️",
          title: "Product Catalog",
          description:
            "Manage SKUs, prices, and reorder thresholds. Soft-delete deactivated products without losing history.",
          accent: "violet",
          to: "/inventory/products",
        },
        {
          icon: "🚚",
          title: "Supplier Network",
          description:
            "Keep supplier contact details organised. Quickly find who supplies what and reorder with confidence.",
          accent: "emerald",
          to: "/inventory/suppliers",
        },
      ]}
    >
      {overviewChildren}
    </ModulePage>
  );
}
