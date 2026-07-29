"use client";
import React from "react";
import { AgentAction } from "@/lib/agentTools";

interface AgentActionChecklistProps {
  summary: string;
  actions: AgentAction[];
  onRunAction: (action: AgentAction) => void;
  onConfirmAction: (action: AgentAction) => void;
}

export const AgentActionChecklist: React.FC<AgentActionChecklistProps> = ({
  summary,
  actions,
  onRunAction,
  onConfirmAction,
}) => {
  if (!actions || actions.length === 0) return null;

  const completedCount = actions.filter((a) => a.status === "done").length;
  const progressPercent = Math.round((completedCount / actions.length) * 100);

  return (
    <div className="w-full bg-slate-900/90 border border-cyan-500/30 backdrop-blur-md rounded-xl p-4 shadow-xl text-slate-100 my-3">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
        <div>
          <h4 className="text-sm font-semibold text-cyan-400 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            AI Agent Action Checklist
          </h4>
          <p className="text-xs text-slate-400 mt-0.5">{summary}</p>
        </div>
        <div className="text-right">
          <span className="text-xs font-mono text-cyan-300 font-bold">
            {completedCount}/{actions.length} Done ({progressPercent}%)
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-slate-800 rounded-full h-1.5 mb-3 overflow-hidden">
        <div
          className="bg-gradient-to-r from-cyan-500 to-blue-500 h-1.5 rounded-full transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="space-y-2">
        {actions.map((act, idx) => (
          <div
            key={act.id || idx}
            className={`flex items-center justify-between p-2.5 rounded-lg border text-xs transition-all ${
              act.status === "done"
                ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300"
                : act.status === "in_progress"
                ? "bg-cyan-950/30 border-cyan-500/40 text-cyan-200 animate-pulse"
                : act.status === "awaiting_confirmation"
                ? "bg-amber-950/30 border-amber-500/50 text-amber-200"
                : act.status === "error"
                ? "bg-red-950/30 border-red-500/40 text-red-300"
                : "bg-slate-950/40 border-slate-800 text-slate-300"
            }`}
          >
            <div className="flex items-center gap-2.5 overflow-hidden">
              <span className="font-mono text-slate-500 font-bold text-[10px]">
                0{idx + 1}
              </span>
              <div className="flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0">
                {act.status === "done" && (
                  <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {act.status === "in_progress" && (
                  <svg className="w-4 h-4 text-cyan-400 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                {act.status === "awaiting_confirmation" && (
                  <span className="text-amber-400 font-bold text-xs">⚠️</span>
                )}
                {act.status === "error" && (
                  <span className="text-red-400 font-bold text-xs">❌</span>
                )}
                {act.status === "pending" && (
                  <span className="w-2 h-2 rounded-full bg-slate-600" />
                )}
              </div>

              <div className="truncate">
                <span className="font-semibold block truncate">{act.description}</span>
                <span className="text-[10px] text-slate-400 font-mono">Tool: {act.tool}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {act.status === "pending" && (
                <button
                  onClick={() => onRunAction(act)}
                  className="px-2 py-1 bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-medium rounded transition-colors"
                >
                  Run Step
                </button>
              )}
              {act.status === "awaiting_confirmation" && (
                <button
                  onClick={() => onConfirmAction(act)}
                  className="px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-medium rounded transition-colors"
                >
                  Approve ⚠️
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
