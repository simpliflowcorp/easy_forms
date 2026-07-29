"use client";
import React, { useState } from "react";
import { AgentState, ExecutionTraceStep, PersonaStage } from "@/agent/types";

interface AgentVisualizerProps {
  agentState: AgentState | null;
  isLoading: boolean;
  onSendPrompt: (prompt: string) => void;
  onMerge: () => void;
  onResume: (ticketId: string) => void;
}

export const AgentVisualizer: React.FC<AgentVisualizerProps> = ({
  agentState,
  isLoading,
  onSendPrompt,
  onMerge,
  onResume,
}) => {
  const [customPrompt, setCustomPrompt] = useState("");
  const [isOnline, setIsOnline] = useState<boolean>(true);

  React.useEffect(() => {
    const eventSource = new EventSource("/api/agent/health-stream");

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setIsOnline(data.status === "online");
      } catch (e) {}
    };

    eventSource.onerror = () => {
      setIsOnline(false);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const presets = [
    { label: "Stage 1 Read Query", prompt: "how many forms do we have?" },
    { label: "Stage 2 Vague Build Request", prompt: "lets build a form." },
    { label: "Stage 2 Detailed Form Build", prompt: "build a feedback form with Full Name, Email, and Star Rating" },
    { label: "Stage 3 Destructive Request", prompt: "delete test form" },
  ];

  const getPersonaNodeClass = (nodePersona: PersonaStage) => {
    if (!agentState) return "bg-slate-900 border-slate-800 text-slate-500 opacity-60";
    if (agentState.activePersona === nodePersona) {
      return "bg-cyan-950 border-cyan-400 text-cyan-200 shadow-lg shadow-cyan-500/20 scale-105 animate-pulse font-bold";
    }
    return "bg-slate-900/90 border-slate-800 text-slate-400 opacity-80";
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-6 space-y-6 text-slate-100 font-sans">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 flex items-center gap-2">
            <span>🤖</span> Easy Forms Agent Loop Visualizer
            {!isOnline && <span className="text-red-500 text-sm ml-2 bg-red-950/50 px-2 py-1 rounded border border-red-500/30">⚠️ LLM OFFLINE</span>}
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time telemetry, persona state machine graph, sandbox store inspector & ticket stage classifier.
          </p>
        </div>

        {/* Ticket Badge */}
        {agentState?.ticket && (
          <div className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-right">
            <div className="text-[10px] text-slate-400 font-mono">ACTIVE TICKET</div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs font-mono font-bold text-cyan-300">{agentState.ticket.ticketId}</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                agentState.ticket.stage === "STAGE_1" ? "bg-blue-950 text-blue-400 border border-blue-500/30" :
                agentState.ticket.stage === "STAGE_2" ? "bg-purple-950 text-purple-400 border border-purple-500/30" :
                "bg-red-950 text-red-400 border border-red-500/30"
              }`}>
                {agentState.ticket.stage}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Simulator Controls */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Chaos Monkey 🐒</h3>
          <p className="text-[10px] text-slate-500 mt-1">Test the hybrid persistence failover by simulating an LLM crash mid-loop.</p>
        </div>
        <button
          onClick={async () => {
            const willSimulate = isOnline; // If online, we want to simulate offline (crash it)
            await fetch("/api/agent/simulate-offline", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ simulateOffline: willSimulate })
            });
            // The SSE stream will catch the update and flip isOnline automatically
          }}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
            isOnline 
              ? "bg-slate-800 hover:bg-red-900/80 text-slate-300 hover:text-red-400 border border-slate-700" 
              : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
          }`}
        >
          {isOnline ? "Force Crash (Simulate Offline)" : "Restore AI Server (Go Online)"}
        </button>
      </div>

      {/* Preset Test Buttons */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Test Suite Presets</h3>
        <div className="flex flex-wrap gap-2">
          {presets.map((p, idx) => (
            <button
              key={idx}
              disabled={isLoading || !isOnline}
              onClick={() => onSendPrompt(p.prompt)}
              className="px-3 py-1.5 bg-slate-950 hover:bg-cyan-950 border border-slate-800 hover:border-cyan-500/40 text-slate-300 hover:text-cyan-300 text-xs font-medium rounded-lg transition-all"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (customPrompt.trim()) {
              onSendPrompt(customPrompt);
              setCustomPrompt("");
            }
          }}
          className="flex gap-2 pt-2"
        >
          <input
            type="text"
            placeholder="Type custom test prompt..."
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            className="flex-1 bg-slate-950 border border-slate-800 text-xs text-white px-4 py-2 rounded-xl focus:outline-none focus:border-cyan-500"
          />
          <button
            type="submit"
            disabled={isLoading || !isOnline}
            className={`px-5 py-2 ${isOnline ? 'bg-cyan-600 hover:bg-cyan-500' : 'bg-slate-700 cursor-not-allowed'} text-white font-bold text-xs rounded-xl shadow-lg transition-all`}
          >
            {isLoading ? "Running Loop..." : !isOnline ? "Offline" : "Run Test"}
          </button>
        </form>
      </div>

      {/* Visual Persona Flow Graph */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 relative overflow-hidden">
        {/* Background ambient glow based on active persona */}
        <div className={`absolute -top-24 -left-24 w-64 h-64 bg-cyan-500/10 blur-3xl rounded-full transition-all duration-1000 ${
          agentState?.activePersona === "DRAFTER" ? "opacity-100 translate-x-0" :
          agentState?.activePersona === "PLANNER" ? "opacity-100 translate-x-[300px]" :
          agentState?.activePersona === "EXECUTOR_SANDBOX" ? "opacity-100 translate-x-[600px]" :
          agentState?.activePersona === "EVALUATOR" ? "opacity-100 translate-x-[900px]" : "opacity-0"
        }`} />

        <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-2 relative z-10 mb-8">
          <span>⚡</span> Agent Loop Visualization Pipeline
        </h3>

        <div className="relative w-full max-w-4xl mx-auto z-10 pb-4">
          {/* Loop Back Arrow (Evaluator -> Executor) */}
          <svg className="absolute top-[-20px] left-[62%] w-[25%] h-8 -translate-x-1/2 z-0 pointer-events-none" preserveAspectRatio="none" viewBox="0 0 100 100">
            <path d="M 90,50 C 90,0 10,0 10,50" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5,5" 
              className={`transition-colors duration-500 ${agentState?.activePersona === "EVALUATOR" ? "text-amber-400 animate-[dash_20s_linear_infinite]" : "text-slate-800"}`} />
            <polygon points="5,45 10,55 15,45" fill="currentColor" 
              className={`transition-colors duration-500 ${agentState?.activePersona === "EVALUATOR" ? "text-amber-400" : "text-slate-800"}`} />
          </svg>

          <div className="flex flex-col md:flex-row items-center justify-between gap-2 relative">
            
            {/* Node 1: Drafter */}
            <div className={`relative z-10 w-full md:w-48 p-4 rounded-xl border text-center transition-all duration-500 ${getPersonaNodeClass("DRAFTER")}`}>
              <div className="text-3xl mb-2 drop-shadow-md">🔍</div>
              <div className="text-xs font-black font-mono tracking-wide">1. DRAFTER</div>
              <div className="text-[10px] opacity-80 mt-1.5 font-medium leading-tight">Prompt Digestion<br/>& Intent Check</div>
            </div>

            {/* Arrow 1 -> 2 */}
            <div className="hidden md:flex flex-1 items-center justify-center -mx-4 z-0">
              <div className={`h-1 w-full rounded-full transition-all duration-500 ${agentState?.activePersona === "DRAFTER" ? "bg-gradient-to-r from-cyan-400 to-transparent animate-pulse shadow-[0_0_10px_rgba(34,211,238,0.5)]" : "bg-slate-800"}`} />
              <div className={`-ml-2 border-t-4 border-t-transparent border-l-[6px] border-b-4 border-b-transparent transition-colors duration-500 ${agentState?.activePersona === "DRAFTER" ? "border-l-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)]" : "border-l-slate-800"}`} />
            </div>

            {/* Node 2: Planner */}
            <div className={`relative z-10 w-full md:w-48 p-4 rounded-xl border text-center transition-all duration-500 ${getPersonaNodeClass("PLANNER")}`}>
              <div className="text-3xl mb-2 drop-shadow-md">📝</div>
              <div className="text-xs font-black font-mono tracking-wide">2. PLANNER</div>
              <div className="text-[10px] opacity-80 mt-1.5 font-medium leading-tight">Action Plan<br/>Compiler</div>
            </div>

            {/* Arrow 2 -> 3 */}
            <div className="hidden md:flex flex-1 items-center justify-center -mx-4 z-0">
              <div className={`h-1 w-full rounded-full transition-all duration-500 ${agentState?.activePersona === "PLANNER" ? "bg-gradient-to-r from-cyan-400 to-transparent animate-pulse shadow-[0_0_10px_rgba(34,211,238,0.5)]" : "bg-slate-800"}`} />
              <div className={`-ml-2 border-t-4 border-t-transparent border-l-[6px] border-b-4 border-b-transparent transition-colors duration-500 ${agentState?.activePersona === "PLANNER" ? "border-l-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)]" : "border-l-slate-800"}`} />
            </div>

            {/* Node 3: Executor */}
            <div className={`relative z-10 w-full md:w-48 p-4 rounded-xl border text-center transition-all duration-500 ${getPersonaNodeClass("EXECUTOR_SANDBOX")}`}>
              <div className="text-3xl mb-2 drop-shadow-md">⚙️</div>
              <div className="text-xs font-black font-mono tracking-wide">3. EXECUTOR</div>
              <div className="text-[10px] opacity-80 mt-1.5 font-medium leading-tight">Isolated Sandbox<br/>Tool Run</div>
            </div>

            {/* Arrow 3 -> 4 */}
            <div className="hidden md:flex flex-1 items-center justify-center -mx-4 z-0">
              <div className={`h-1 w-full rounded-full transition-all duration-500 ${agentState?.activePersona === "EXECUTOR_SANDBOX" ? "bg-gradient-to-r from-cyan-400 to-transparent animate-pulse shadow-[0_0_10px_rgba(34,211,238,0.5)]" : "bg-slate-800"}`} />
              <div className={`-ml-2 border-t-4 border-t-transparent border-l-[6px] border-b-4 border-b-transparent transition-colors duration-500 ${agentState?.activePersona === "EXECUTOR_SANDBOX" ? "border-l-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)]" : "border-l-slate-800"}`} />
            </div>

            {/* Node 4: Evaluator */}
            <div className={`relative z-10 w-full md:w-48 p-4 rounded-xl border text-center transition-all duration-500 ${getPersonaNodeClass("EVALUATOR")}`}>
              <div className="text-3xl mb-2 drop-shadow-md">🧪</div>
              <div className="text-xs font-black font-mono tracking-wide">4. EVALUATOR</div>
              <div className="text-[10px] opacity-80 mt-1.5 font-medium leading-tight">QA Check &<br/>Loop Control</div>
            </div>

          </div>
        </div>
      </div>

        {/* Final Merge Banner */}
        {agentState?.isComplete && agentState.activePersona === "AWAITING_USER_APPROVAL" && (
          <div className="bg-emerald-950/60 border border-emerald-500/50 rounded-xl p-4 flex items-center justify-between animate-fade-in">
            <div>
              <span className="text-xs font-bold text-emerald-400 block">🎉 Evaluation Passed (Awaiting Final Approval)</span>
              <span className="text-[11px] text-slate-300">Sandbox store is ready to be merged to production database.</span>
            </div>
            <button
              onClick={onMerge}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg shadow-lg shadow-emerald-600/30 transition-all whitespace-nowrap"
            >
              Approve & Merge to DB 🚀
            </button>
          </div>
        )}

        {/* LLM Error Resume Banner */}
        {agentState?.ticket.status === "LLM_ERROR" && (
          <div className="bg-red-950/60 border border-red-500/50 rounded-xl p-4 flex items-center justify-between animate-fade-in mt-4">
            <div>
              <span className="text-xs font-bold text-red-400 block">⚠️ AI Engine Interrupted</span>
              <span className="text-[11px] text-slate-300">Execution failed at the {agentState.activePersona} stage. State saved to database.</span>
            </div>
            <button
              onClick={() => onResume(agentState.ticket.ticketId)}
              disabled={isLoading || !isOnline}
              className={`px-4 py-2 ${isOnline ? 'bg-red-600 hover:bg-red-500' : 'bg-slate-700 cursor-not-allowed'} text-white font-bold text-xs rounded-lg shadow-lg transition-all whitespace-nowrap`}
            >
              {isLoading ? "Resuming..." : !isOnline ? "Offline" : "Resume Ticket 🔄"}
            </button>
          </div>
        )}

      {/* Grid: Execution Trace Logs & Sandbox Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Execution Telemetry Trace Log */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col h-[400px]">
          <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span>📜</span> Execution Telemetry Trace
          </h3>

          <div className="flex-1 overflow-y-auto space-y-2 pr-2">
            {(!agentState?.executionTrace || agentState.executionTrace.length === 0) ? (
              <div className="text-slate-500 text-xs font-mono h-full flex items-center justify-center">
                No telemetry trace available. Run a prompt above to observe the loop.
              </div>
            ) : (
              agentState.executionTrace.map((trc: ExecutionTraceStep) => (
                <div key={trc.stepId} className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5 text-xs font-mono space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-cyan-400 font-bold">{trc.persona}</span>
                    <span className="text-slate-500">{trc.timestamp}</span>
                  </div>
                  <div className="text-slate-200 text-[11px]">{trc.message}</div>
                  {trc.payload && (
                    <pre className="text-[10px] text-slate-400 bg-slate-900/60 p-1.5 rounded overflow-x-auto">
                      {JSON.stringify(trc.payload, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Live Sandbox Store Inspector */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col h-[400px]">
          <h3 className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span>📦</span> Live Sandbox Store Inspector
          </h3>

          <div className="flex-1 overflow-y-auto bg-slate-950/90 border border-slate-800 rounded-xl p-3 text-xs font-mono text-purple-300">
            {agentState?.sandbox ? (
              <pre className="overflow-x-auto">{JSON.stringify(agentState.sandbox, null, 2)}</pre>
            ) : (
              <div className="text-slate-500 h-full flex items-center justify-center">
                Sandbox store is empty.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
