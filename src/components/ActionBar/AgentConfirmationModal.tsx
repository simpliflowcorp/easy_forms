"use client";
import React from "react";
import { AgentAction } from "@/agent/types";
import toast from "react-hot-toast";

/**
 * D-S2.7 — Selective merge UI.
 *
 * One checkbox per pending sandbox action + a "Select all / none" master
 * checkbox. Merge carries ONLY the checked actions.
 *
 * 3-touch coordination (see agent_d_log):
 *   - THIS modal POSTs `{ ticketId, userId, mergeApprovedActionIds }` to the
 *     merge/resume route (`/api/agent/execute` with `mergeApproved: true`).
 *   - Agent A's `agentLoop.ts` resume path reads `mergeApprovedActionIds`
 *     (one-line passthrough).
 *   - Agent B's `sandboxMerge.ts` filters the sandbox by
 *     `mergeApprovedActionIds` before applying.
 *
 * Frozen contract: `MergeRequest = { ticketId, userId, mergeApprovedActionIds }`
 * defined in `src/agent/sandbox/types.ts` (Agent B owns it). The type is
 * mirrored here so this component compiles before B ships; at the integration
 * gate it must be aliased to the import from B's file.
 */

export interface MergeRequest {
  ticketId: string;
  userId: string;
  mergeApprovedActionIds: string[];
}

export interface SandboxActionItem {
  actionId: string;
  tool: string;
  description?: string;
  params?: Record<string, unknown>;
}

interface AgentConfirmationModalProps {
  isOpen: boolean;
  action: AgentAction | null;
  formId?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** D-S2.7 — pending sandbox actions; when non-empty the modal renders the
   *  selective-merge flow instead of the legacy destructive confirmation. */
  sandboxActions?: SandboxActionItem[];
  ticketId?: string;
  userId?: string;
  /** Optional custom submit; defaults to POST /api/agent/execute. */
  onMergeRequest?: (req: MergeRequest) => void | Promise<void>;
}

export const AgentConfirmationModal: React.FC<AgentConfirmationModalProps> = ({
  isOpen,
  action,
  formId,
  onConfirm,
  onCancel,
  sandboxActions = [],
  ticketId,
  userId,
  onMergeRequest,
}) => {
  const [checkedIds, setCheckedIds] = React.useState<string[]>([]);
  const masterRef = React.useRef<HTMLInputElement>(null);

  // Reset the selection whenever the action set changes
  React.useEffect(() => {
    setCheckedIds(sandboxActions.map((a) => a.actionId));
  }, [sandboxActions, isOpen]);

  const mergeMode = sandboxActions.length > 0;
  const allChecked = checkedIds.length === sandboxActions.length;
  const someChecked = checkedIds.length > 0 && !allChecked;

  React.useEffect(() => {
    if (masterRef.current) {
      masterRef.current.indeterminate = someChecked && sandboxActions.length > 0;
    }
  }, [someChecked, sandboxActions.length]);

  if (!isOpen) return null;

  const toggleAction = (actionId: string) => {
    setCheckedIds((prev) =>
      prev.includes(actionId) ? prev.filter((id) => id !== actionId) : [...prev, actionId],
    );
  };

  const toggleAll = () => {
    setCheckedIds(allChecked ? [] : sandboxActions.map((a) => a.actionId));
  };

  const handleMerge = async () => {
    if (!ticketId) {
      toast.error("Missing ticket id for merge");
      return;
    }
    const req: MergeRequest = {
      ticketId,
      userId: userId ?? "",
      mergeApprovedActionIds: checkedIds,
    };
    try {
      if (onMergeRequest) {
        await onMergeRequest(req);
      } else {
        const res = await fetch("/api/agent/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: "",
            mergeApproved: true,
            resumeTicketId: ticketId,
            mergeApprovedActionIds: checkedIds,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Merge request failed: ${res.status}`);
        }
      }
      toast.success(`Merging ${checkedIds.length}/${sandboxActions.length} sandbox action(s)`);
      onCancel();
    } catch (err: any) {
      toast.error(err?.message ?? "Merge failed");
    }
  };

  if (!mergeMode) {
    if (!action) return null;

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
  }

  // ─── Selective-merge flow (D-S2.7) ──────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl max-w-xl w-full p-6 shadow-2xl text-slate-100 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3 text-emerald-400">
          <div className="w-10 h-10 rounded-full bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center text-xl flex-shrink-0">
            ✅
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">Confirm & Merge Sandbox Changes</h3>
            <p className="text-xs text-emerald-400 font-mono">
              Merge carries ONLY the actions you check below
            </p>
          </div>
        </div>

        {/* Master checkbox */}
        <div className="flex items-center justify-between bg-slate-950/70 rounded-xl px-4 py-3 border border-slate-800">
          <label className="flex items-center gap-3 text-sm font-semibold cursor-pointer select-none">
            <input
              ref={masterRef}
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              className="w-4 h-4 accent-emerald-500 cursor-pointer"
            />
            Select all / none ({checkedIds.length}/{sandboxActions.length})
          </label>
          <button
            onClick={toggleAll}
            className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 bg-slate-800/70 hover:bg-slate-700 px-2.5 py-1 rounded-lg transition-colors"
          >
            {allChecked ? "None" : "All"}
          </button>
        </div>

        {/* Per-action checkboxes */}
        <div className="bg-slate-950/60 rounded-xl border border-slate-800 divide-y divide-slate-800/70 max-h-64 overflow-y-auto">
          {sandboxActions.map((item) => {
            const checked = checkedIds.includes(item.actionId);
            return (
              <label
                key={item.actionId}
                className={`flex items-start gap-3 px-4 py-3 cursor-pointer select-none transition-colors ${
                  checked ? "bg-emerald-950/30" : "hover:bg-slate-900/50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleAction(item.actionId)}
                  className="w-4 h-4 accent-emerald-500 cursor-pointer mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 rounded px-1.5 py-0.5">
                      {item.tool}
                    </span>
                    {checked && (
                      <span className="text-[10px] text-emerald-300">✓ will merge</span>
                    )}
                    {!checked && (
                      <span className="text-[10px] text-slate-500">discarded</span>
                    )}
                  </div>
                  {item.description && (
                    <p className="text-xs text-slate-300 mt-1">{item.description}</p>
                  )}
                  {item.params && (
                    <p className="text-[10px] font-mono text-slate-500 mt-1 truncate">
                      {JSON.stringify(item.params)}
                    </p>
                  )}
                </div>
              </label>
            );
          })}
        </div>

        {/* Controls */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleMerge}
            disabled={checkedIds.length === 0}
            className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg shadow-lg shadow-emerald-600/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Confirm & Merge ({checkedIds.length}) 🚀
          </button>
        </div>
      </div>
    </div>
  );
};

export default AgentConfirmationModal;
