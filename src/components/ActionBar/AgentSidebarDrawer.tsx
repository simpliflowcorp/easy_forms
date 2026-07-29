"use client";
import React from "react";
import { AgentState, PersonaStage } from "@/agent/types";
import { AgentActionChecklist } from "./AgentActionChecklist";

interface AgentSidebarDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  agentState: AgentState | null;
  latestMessage?: string;
  onMerge: () => void;
  onSendPrompt: (prompt: string) => void;
}

export const AgentSidebarDrawer: React.FC<AgentSidebarDrawerProps> = ({
  isOpen,
  onClose,
  agentState,
  latestMessage,
  onMerge,
  onSendPrompt,
}) => {
  const [quickInput, setQuickInput] = React.useState("");

  if (!isOpen) return null;

  const getPersonaBadge = (stage?: PersonaStage) => {
    switch (stage) {
      case "DRAFTER":
        return <span className="px-2.5 py-1 rounded bg-purple-950 text-purple-300 font-mono text-xs border border-purple-500/40">1. DRAFTER 🔍</span>;
      case "PLANNER":
        return <span className="px-2.5 py-1 rounded bg-blue-950 text-blue-300 font-mono text-xs border border-blue-500/40">2. PLANNER 📝</span>;
      case "EXECUTOR_SANDBOX":
        return <span className="px-2.5 py-1 rounded bg-amber-950 text-amber-300 font-mono text-xs border border-amber-500/40">3. EXECUTOR (SANDBOX) ⚙️</span>;
      case "EVALUATOR":
        return <span className="px-2.5 py-1 rounded bg-cyan-950 text-cyan-300 font-mono text-xs border border-cyan-500/40">4. EVALUATOR 🧪</span>;
      case "AWAITING_USER_APPROVAL":
        return <span className="px-2.5 py-1 rounded bg-emerald-950 text-emerald-300 font-mono text-xs border border-emerald-500/40 animate-pulse">AWAITING APPROVAL ✋</span>;
      case "MERGED_TO_PRODUCTION":
        return <span className="px-2.5 py-1 rounded bg-emerald-900 text-white font-mono text-xs border border-emerald-400">MERGED TO DB ✅</span>;
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-slate-900 border-l border-cyan-500/30 shadow-2xl flex flex-col backdrop-blur-xl animate-slide-in text-slate-100">
      {/* Drawer Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/70">
        <div className="flex items-center gap-2">
          <span className="text-xl">🤖</span>
          <div>
            <h3 className="text-sm font-bold text-cyan-400">Stage 2 Agent Assistant</h3>
            <p className="text-[10px] text-slate-400 font-mono">Ticket: {agentState?.ticket?.ticketId || "Pending"}</p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 p-1.5 rounded-lg text-xs"
        >
          ✕ Close
        </button>
      </div>

      {/* Stage Badge Bar */}
      <div className="px-5 py-2.5 bg-slate-950/40 border-b border-slate-800 flex items-center justify-between">
        <span className="text-xs text-slate-400 font-semibold">Active Persona:</span>
        {getPersonaBadge(agentState?.activePersona)}
      </div>

      {/* Chat & Processing Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Agent Response Dialogue Bubble */}
        {latestMessage && (
          <div className="bg-slate-950/90 border border-cyan-500/30 rounded-xl p-3.5 text-xs text-slate-200 shadow-md">
            <span className="font-semibold text-cyan-400 block mb-1">AI Assistant Dialogue</span>
            <p className="whitespace-pre-wrap text-slate-300 leading-relaxed">{latestMessage}</p>
          </div>
        )}

        {/* Action Checklist & Strategy */}
        {agentState?.actionPlan && agentState.actionPlan.length > 0 && (
          <AgentActionChecklist
            summary={`Plan Strategy (Sandbox Iteration ${agentState.iterationCount}/${agentState.maxIterations})`}
            actions={agentState.actionPlan}
            onRunAction={() => {}}
            onConfirmAction={() => {}}
          />
        )}

        {/* Final Production DB Merge Control */}
        {agentState?.isComplete && agentState.activePersona === "AWAITING_USER_APPROVAL" && (
          <div className="bg-emerald-950/40 border border-emerald-500/50 rounded-xl p-4 text-xs space-y-3">
            <div className="flex items-center gap-2 text-emerald-400 font-bold">
              <span>🎉</span> Sandbox Evaluation Passed!
            </div>
            <p className="text-slate-300 text-[11px]">
              The Evaluator verified that all draft actions match your requirements. Would you like to merge the Sandbox draft to the production database?
            </p>
            <button
              onClick={onMerge}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg shadow-lg shadow-emerald-600/30 transition-all text-xs"
            >
              Approve & Merge to Database 🚀
            </button>
          </div>
        )}
      </div>

      {/* Drawer Input Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/80">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (quickInput.trim()) {
              onSendPrompt(quickInput);
              setQuickInput("");
            }
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            placeholder="Reply with details or fields..."
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            className="flex-1 bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 px-3 py-2 rounded-lg focus:outline-none focus:border-cyan-500"
          />
          <button
            type="submit"
            className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold rounded-lg"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
};
