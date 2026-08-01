"use client";
import React, { useState, useEffect } from "react";
import toast from "react-hot-toast";

interface CustomTableViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  formId: string;
  formName?: string;
  initialData?: any;
}

export const CustomTableViewModal: React.FC<CustomTableViewModalProps> = ({
  isOpen,
  onClose,
  formId,
  formName = "Form Submissions",
  initialData,
}) => {
  const [responses, setResponses] = useState<any[]>(initialData?.responses || []);
  const [total, setTotal] = useState<number>(initialData?.total || 0);
  const [loading, setLoading] = useState<boolean>(false);
  const [savedViews, setSavedViews] = useState<any[]>([]);
  const [selectedViewId, setSelectedViewId] = useState<string>("");
  const [newViewName, setNewViewName] = useState<string>("");
  const [showSaveInput, setShowSaveInput] = useState<boolean>(false);

  // Filter state
  const [fieldFilter, setFieldFilter] = useState<string>("");
  const [operatorFilter, setOperatorFilter] = useState<string>("contains");
  const [valueFilter, setValueFilter] = useState<string>("");
  const [activeFilters, setActiveFilters] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen && formId) {
      fetchResponses();
      fetchCustomViews();
    }
  }, [isOpen, formId]);

  const fetchResponses = async (filters: any[] = activeFilters) => {
    setLoading(true);
    try {
      const res = await fetch("/api/agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directExecute: true,
          tool: "query_responses",
          params: { formId, filters },
        }),
      });
      const data = await res.json();
      if (data.success && data.result) {
        setResponses(data.result.responses || []);
        setTotal(data.result.total || 0);
      }
    } catch (err: any) {
      toast.error("Failed to load response data");
    } finally {
      setLoading(false);
    }
  };

  const fetchCustomViews = async () => {
    try {
      const res = await fetch(`/api/views?formId=${formId}`);
      const data = await res.json();
      if (data.views) setSavedViews(data.views);
    } catch (err) {}
  };

  const addFilter = () => {
    if (!fieldFilter || !valueFilter) return;
    const newFilters = [
      ...activeFilters,
      { field: fieldFilter, operator: operatorFilter, value: valueFilter },
    ];
    setActiveFilters(newFilters);
    setFieldFilter("");
    setValueFilter("");
    fetchResponses(newFilters);
  };

  const removeFilter = (idx: number) => {
    const updated = activeFilters.filter((_, i) => i !== idx);
    setActiveFilters(updated);
    fetchResponses(updated);
  };

  const saveCurrentView = async () => {
    if (!newViewName.trim()) return;
    try {
      const res = await fetch("/api/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formId,
          name: newViewName,
          filters: activeFilters,
        }),
      });
      const data = await res.json();
      if (data.view) {
        toast.success(`Custom View '${newViewName}' saved!`);
        setNewViewName("");
        setShowSaveInput(false);
        fetchCustomViews();
      }
    } catch (err) {
      toast.error("Failed to save custom view");
    }
  };

  const applyCustomView = (viewId: string) => {
    setSelectedViewId(viewId);
    const view = savedViews.find((v) => v._id === viewId);
    if (view && Array.isArray(view.filters)) {
      setActiveFilters(view.filters);
      fetchResponses(view.filters);
    }
  };

  const deleteView = async (viewId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this custom table view?")) return;
    try {
      const res = await fetch(`/api/views?viewId=${viewId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Custom view deleted");
        fetchCustomViews();
        if (selectedViewId === viewId) setSelectedViewId("");
      }
    } catch (err) {
      toast.error("Failed to delete view");
    }
  };

  if (!isOpen) return null;

  // Extract dynamically generated data keys
  const allKeys = new Set<string>();
  responses.forEach((r) => {
    if (r.data && typeof r.data === "object") {
      Object.keys(r.data).forEach((k) => allKeys.add(k));
    }
  });
  const columnHeaders = Array.from(allKeys);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-slate-900 border border-cyan-500/30 rounded-2xl w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl overflow-hidden text-slate-100">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div>
            <h3 className="text-lg font-bold text-cyan-400 flex items-center gap-2">
              <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {formName} — Read-Only Responses Table
            </h3>
            <p className="text-xs text-slate-400">Total Submissions: {total} (Responses are strictly read-only)</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (!responses.length) return toast.error("No data to export");
                
                // Extract only actual field data, skipping mongoose internals
                const flatData = responses.map(r => {
                  if (r.data) return r.data; // Response collection structure
                  const { _id, form_id, __v, normalized_data, user, ...rest } = r;
                  return rest; // Fallback for other collections
                });
                
                if (flatData.length === 0) return toast.error("No exportable fields found");
                
                const headers = Array.from(new Set(flatData.flatMap(Object.keys)));
                const csvRows = [headers.join(",")];
                
                for (const row of flatData) {
                  const values = headers.map(header => {
                    const val = row[header];
                    const str = val !== null && val !== undefined ? String(val) : "";
                    // escape quotes and wrap in quotes
                    return `"${str.replace(/"/g, '""')}"`;
                  });
                  csvRows.push(values.join(","));
                }
                
                const csvString = csvRows.join("\n");
                const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.setAttribute("download", `export_${formId}_${Date.now()}.csv`);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
              className="px-3 py-1.5 bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/40 text-emerald-300 text-xs font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download CSV
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 p-2 rounded-lg transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Custom Views Bar & Filter Controls */}
        <div className="p-4 bg-slate-950/30 border-b border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Custom Saved View Selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">Custom Views:</span>
              <select
                value={selectedViewId}
                onChange={(e) => applyCustomView(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-xs rounded-lg px-3 py-1.5 text-cyan-300 focus:outline-none focus:border-cyan-500"
              >
                <option value="">Default View (All)</option>
                {savedViews.map((v) => (
                  <option key={v._id} value={v._id}>
                    {v.name} ({v.filters?.length || 0} filters)
                  </option>
                ))}
              </select>

              {selectedViewId && (
                <button
                  onClick={(e) => deleteView(selectedViewId, e)}
                  className="text-xs text-red-400 hover:text-red-300 bg-red-950/40 border border-red-500/30 px-2 py-1 rounded"
                >
                  Delete View
                </button>
              )}
            </div>

            {/* Save View Button */}
            {!showSaveInput ? (
              <button
                onClick={() => setShowSaveInput(true)}
                className="px-3 py-1.5 bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-500/40 text-cyan-300 text-xs font-medium rounded-lg transition-colors"
              >
                + Save Active Filters as View
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="View Name..."
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  className="bg-slate-800 border border-slate-700 text-xs rounded-lg px-2.5 py-1 text-white focus:outline-none focus:border-cyan-500"
                />
                <button
                  onClick={saveCurrentView}
                  className="px-3 py-1 bg-cyan-600 text-white text-xs font-medium rounded-lg hover:bg-cyan-500"
                >
                  Save
                </button>
                <button
                  onClick={() => setShowSaveInput(false)}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Filter Input Inputs */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/60">
            <span className="text-xs text-slate-400">Filter By:</span>
            <input
              type="text"
              placeholder="Field name (e.g. Rating, Email)"
              value={fieldFilter}
              onChange={(e) => setFieldFilter(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-xs rounded-lg px-2.5 py-1 text-slate-200 focus:outline-none focus:border-cyan-500"
            />
            <select
              value={operatorFilter}
              onChange={(e) => setOperatorFilter(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-xs rounded-lg px-2.5 py-1 text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="contains">contains</option>
              <option value="equals">equals</option>
              <option value="gt">greater than</option>
              <option value="lt">less than</option>
            </select>
            <input
              type="text"
              placeholder="Value..."
              value={valueFilter}
              onChange={(e) => setValueFilter(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-xs rounded-lg px-2.5 py-1 text-slate-200 focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={addFilter}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 text-xs font-medium rounded-lg"
            >
              + Add Filter
            </button>
          </div>

          {/* Active Filter Badges */}
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {activeFilters.map((f, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-950/60 border border-cyan-500/30 text-[11px] text-cyan-300"
                >
                  <strong>{f.field}</strong> {f.operator} "{f.value}"
                  <button
                    onClick={() => removeFilter(i)}
                    className="hover:text-red-400 ml-1 font-bold"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-cyan-400 font-mono text-sm">
              <svg className="w-6 h-6 animate-spin mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Querying database responses...
            </div>
          ) : responses.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-slate-500 text-sm font-mono">
              No matching submission responses found.
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                  <th className="p-3 font-semibold font-mono">Submitted At</th>
                  {columnHeaders.map((col) => (
                    <th key={col} className="p-3 font-semibold capitalize">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {responses.map((r, i) => (
                  <tr key={r._id || i} className="hover:bg-slate-800/40 transition-colors">
                    <td className="p-3 text-slate-400 font-mono whitespace-nowrap">
                      {new Date(r.submitted_at).toLocaleString()}
                    </td>
                    {columnHeaders.map((col) => (
                      <td key={col} className="p-3 text-slate-200">
                        {r.data?.[col] !== undefined ? String(r.data[col]) : "-"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
