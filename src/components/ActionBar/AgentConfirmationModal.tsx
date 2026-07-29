"use client";
import React from "react";
import { AgentAction } from "@/agent/types";
import toast from "react-hot-toast";

interface AgentConfirmationModalProps {
  isOpen: boolean;
  action: AgentAction | null;
  formId?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const AgentConfirmationModal: React.FC<AgentConfirmationModalProps> = ({
  isOpen,
  action,
  formId,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen || !action) return null;

  const handleExportBackup = (type: "json" | "csv") => {
    const targetId = action.params?.formId || formId;
    if (!targetId) {
      toast.error("No active form ID found to backup");
      return;
    }
    const url = `/api/export/${type}?formId=${targetId}`;
    window.open(url, "_blank");
    toast.success(`Exporting backup ${type.toUpperCase()}...`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-slate-900 border border-red-500/40 rounded-2xl max-w-lg w-full p-6 shadow-2xl text-slate-100 space-y-4">
        
        {/* Header */}
        <div className="flex items-center gap-3 text-red-400">
          <div className="w-10 h-10 rounded-full bg-red-950/60 border border-red-500/40 flex items-center justify-center text-xl flex-shrink-0">
            ⚠️
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">Stage 3: Destructive Action Confirmation</h3>
            <p className="text-xs text-red-400 font-mono">Requires explicit confirmation before deletion</p>
          </div>
        </div>

        <p className="text-slate-300 text-xs leading-relaxed">
          The AI Agent is processing a <strong className="text-red-400 font-semibold">Stage 3 Ticket request</strong>: {action.description}. Deleting a form or view is permanent and cannot be undone.
        </p>

        {/* Backup Suggestions Container */}
        <div className="bg-slate-950/80 rounded-xl p-3.5 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-cyan-400">
            <span>💡 Recommended: Download Backup First</span>
          </div>
          <p className="text-[11px] text-slate-400">
            Before deleting, export submission responses to secure your data:
          </p>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => handleExportBackup("json")}
              className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 font-mono text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              <span>📥</span> Export JSON
            </button>
            <button
              onClick={() => handleExportBackup("csv")}
              className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-emerald-300 font-mono text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              <span>📊</span> Export CSV
            </button>
          </div>
        </div>

        {/* Action Details */}
        <div className="bg-slate-950/60 rounded-lg p-3 border border-slate-800 text-[11px] font-mono text-slate-400">
          <div>Tool: <span className="text-slate-200">{action.tool}</span></div>
          <div>Params: <span className="text-slate-300">{JSON.stringify(action.params)}</span></div>
        </div>

        {/* Controls */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Cancel Action
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg shadow-lg shadow-red-600/30 transition-all"
          >
            Confirm & Permanently Delete 🗑️
          </button>
        </div>
      </div>
    </div>
  );
};
