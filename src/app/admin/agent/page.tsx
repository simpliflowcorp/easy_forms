"use client";

import { useState, useEffect } from "react";

interface UsageData {
  period: string;
  startDate: string;
  totals: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    totalCost: number;
    callCount: number;
  };
  byModel: Array<{
    _id: string;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    totalCost: number;
    callCount: number;
  }>;
  byPersona: Array<{
    _id: string;
    totalTokens: number;
    totalCost: number;
    callCount: number;
  }>;
  byDate: Array<{
    _id: string;
    totalTokens: number;
    totalCost: number;
    callCount: number;
  }>;
  topTickets: Array<{
    _id: string;
    totalTokens: number;
    totalCost: number;
    callCount: number;
  }>;
}

export default function AdminAgentUsage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<"day" | "week" | "month" | "all">("day");

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/agent/usage?period=${period}`);
      if (!res.ok) throw new Error("Failed to fetch usage data");
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [period]);

  if (loading) return <div className="p-8 text-center text-gray-500">Loading usage data…</div>;
  if (error) return <div className="p-8 text-center text-red-500">Error: {error}</div>;
  if (!data) return <div className="p-8 text-center text-gray-500">No data</div>;

  const formatNumber = (n: number) => n.toLocaleString();
  const formatCost = (c: number) => `$${c.toFixed(4)}`;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Agent Token Usage Dashboard</h1>
        <div className="flex gap-2">
          {(["day", "week", "month", "all"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded text-sm ${
                period === p
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow border">
          <p className="text-sm text-gray-500">Total Tokens</p>
          <p className="text-2xl font-bold">{formatNumber(data.totals.totalTokens)}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow border">
          <p className="text-sm text-gray-500">Prompt Tokens</p>
          <p className="text-2xl font-bold">{formatNumber(data.totals.promptTokens)}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow border">
          <p className="text-sm text-gray-500">Completion Tokens</p>
          <p className="text-2xl font-bold">{formatNumber(data.totals.completionTokens)}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow border">
          <p className="text-sm text-gray-500">Estimated Cost</p>
          <p className="text-2xl font-bold text-green-600">{formatCost(data.totals.totalCost)}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Model */}
        <div className="bg-white p-4 rounded-lg shadow border">
          <h3 className="text-lg font-medium mb-4">Usage by Model</h3>
          <div className="space-y-3">
            {data.byModel.map((m) => (
              <div key={m._id} className="flex items-center gap-3">
                <span className="font-mono text-sm text-gray-600 w-40 truncate">{m._id}</span>
                <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500"
                    style={{ width: `${data.totals.totalTokens > 0 ? (m.totalTokens / data.totals.totalTokens) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-sm text-gray-600 w-24 text-right">
                  {formatNumber(m.totalTokens)} ({((m.totalTokens / (data.totals.totalTokens || 1)) * 100).toFixed(1)}%)
                </span>
              </div>
            ))}
            {data.byModel.length === 0 && <p className="text-gray-500 text-center py-4">No model data</p>}
          </div>
        </div>

        {/* By Persona */}
        <div className="bg-white p-4 rounded-lg shadow border">
          <h3 className="text-lg font-medium mb-4">Usage by Persona</h3>
          <div className="space-y-3">
            {data.byPersona.map((p) => (
              <div key={p._id} className="flex items-center gap-3">
                <span className="font-medium text-sm capitalize w-28">{p._id.toLowerCase()}</span>
                <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500"
                    style={{ width: `${data.totals.totalTokens > 0 ? (p.totalTokens / data.totals.totalTokens) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-sm text-gray-600 w-24 text-right">
                  {formatNumber(p.totalTokens)} ({formatCost(p.totalCost)})
                </span>
              </div>
            ))}
            {data.byPersona.length === 0 && <p className="text-gray-500 text-center py-4">No persona data</p>}
          </div>
        </div>

        {/* Daily Trend */}
        <div className="bg-white p-4 rounded-lg shadow border lg:col-span-2">
          <h3 className="text-lg font-medium mb-4">Daily Token Usage</h3>
          <div className="h-64 space-y-2">
            {data.byDate.map((d) => (
              <div key={d._id} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-24">{d._id}</span>
                <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden relative">
                  <div
                    className="h-full bg-purple-500"
                    style={{ width: `${data.totals.totalTokens > 0 ? (d.totalTokens / data.totals.totalTokens) * 100 : 0}%` }}
                  />
                  <span className="absolute right-2 top-0 text-xs text-white font-medium">
                    {formatNumber(d.totalTokens)}
                  </span>
                </div>
              </div>
            ))}
            {data.byDate.length === 0 && <p className="text-gray-500 text-center py-8">No daily data</p>}
          </div>
        </div>

        {/* Top Tickets */}
        <div className="bg-white p-4 rounded-lg shadow border lg:col-span-2">
          <h3 className="text-lg font-medium mb-4">Top Tickets by Token Usage</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">Ticket ID</th>
                  <th className="pb-2 text-right">Tokens</th>
                  <th className="pb-2 text-right">Cost</th>
                  <th className="pb-2 text-right">Calls</th>
                </tr>
              </thead>
              <tbody>
                {data.topTickets.map((t) => (
                  <tr key={t._id} className="border-b border-gray-100">
                    <td className="py-2 font-mono text-xs truncate max-w-xs">{t._id}</td>
                    <td className="py-2 text-right">{formatNumber(t.totalTokens)}</td>
                    <td className="py-2 text-right">{formatCost(t.totalCost)}</td>
                    <td className="py-2 text-right">{t.callCount}</td>
                  </tr>
                ))}
                {data.topTickets.length === 0 && (
                  <tr><td colSpan={4} className="py-4 text-center text-gray-500">No ticket data</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}