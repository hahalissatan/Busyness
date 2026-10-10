/**
 * DataTable — reusable table with pagination, search, and empty/error states.
 */

import { useState, useEffect } from "react";
import { Spinner } from "./Spinner.jsx";
import { EmptyState } from "./EmptyState.jsx";
import { ErrorState } from "./ErrorState.jsx";
import { ChevronLeft, ChevronRight, Search } from "../icons.jsx";

export function DataTable({
  columns,
  fetchData,
  searchPlaceholder = "Search...",
  searchParam = "search",
  actions,
  filters,
  emptyTitle = "No records found",
  emptyMessage = "Records will appear here once created.",
  emptyIcon = "📦",
  rowKey = "id",
  onRowClick,
}) {
  const [data, setData] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, total_pages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, limit: 20 };
      if (search) params[searchParam] = search;
      const result = await fetchData(params);
      setData(result.data);
      setPagination(result.pagination);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search]);

  const totalPages = pagination.total_pages || Math.ceil(pagination.total / pagination.limit) || 1;

  if (loading) {
    return (
      <div className="card">
        <div className="py-16"><Spinner size="lg" /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  if (data.length === 0 && !search) {
    return (
      <div className="card">
        <EmptyState icon={emptyIcon} title={emptyTitle} message={emptyMessage} action={actions?.create} />
      </div>
    );
  }

  return (
    <div className="card overflow-hidden p-0">
      {/* Search + actions bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={searchPlaceholder}
            className="input pl-9 py-2"
          />
        </div>
        {filters}
        <div className="ml-auto">{actions?.create}</div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={col.headerClass || "table-header"}>
                  {col.label}
                </th>
              ))}
              {actions && <th className="table-header text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr
                key={row[rowKey]}
                className={onRowClick ? "table-row cursor-pointer" : "table-row"}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td key={col.key} className={col.cellClass || "table-cell"}>
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
                {actions && (
                  <td className="table-cell text-right whitespace-nowrap">
                    {actions.edit && (
                      <button onClick={(e) => { e.stopPropagation(); actions.edit(row); }} className="text-brand-600 hover:text-brand-800 p-1">
                        Edit
                      </button>
                    )}
                    {actions.delete && (
                      <button onClick={(e) => { e.stopPropagation(); actions.delete(row); }} className="text-red-600 hover:text-red-800 p-1">
                        Delete
                      </button>
                    )}
                    {actions.custom?.(row)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <p className="text-sm text-gray-500">
            Showing {(page - 1) * pagination.limit + 1}–{Math.min(page * pagination.limit, pagination.total)} of {pagination.total}
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn-secondary !py-1 !px-2"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 py-1 text-sm text-gray-600">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="btn-secondary !py-1 !px-2"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
