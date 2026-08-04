"use client";
import React, { useState, useMemo } from "react";
import { AgentState, ExecutionTraceStep } from "@/agent/types";
import { ReactFlow, Background, MarkerType, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// Sci-Fi Custom Persona Node (Pure SCSS, No Tailwind)
const PersonaNode = ({ data }: any) => {
  return (
    <div className={`scifi-node ${data.isSystem ? 'scifi-node-system' : ''} ${data.isAmber ? 'scifi-node-amber' : data.isActive ? 'scifi-node-active' : ''}`}>
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className="scifi-handle"
        style={{ top: '-6px', left: '50%' }}
      />
      <Handle
        type="source"
        position={Position.Top}
        id="top-source"
        className="scifi-handle scifi-handle-source-amber"
        style={{ left: '70%', top: '-6px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="scifi-handle"
        style={{ left: '-6px' }}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom-target"
        className="scifi-handle scifi-handle-source-amber"
        style={{ left: '30%', bottom: '-6px' }}
      />

      {/* Node Top Meta Header */}
      <div className="scifi-node-header">
        <span className="scifi-node-subtag">{data.subTag}</span>
        <span className={`scifi-node-status-tag ${data.isActive ? 'active' : data.isAmber ? 'sandbox' : 'standby'}`}>
          {data.isActive ? 'ACTIVE' : data.isAmber ? 'SANDBOX' : 'STANDBY'}
        </span>
      </div>

      {/* Main Content */}
      <div className="scifi-node-body">
        <div className="scifi-node-icon">
          {data.icon}
        </div>
        <div>
          <div className="scifi-node-label">{data.label}</div>
          <div className="scifi-node-desc">{data.desc}</div>
        </div>
      </div>

      {/* Progress Track */}
      <div className="scifi-node-progress-track">
        <div className={`scifi-node-progress-bar ${data.isActive ? 'active' : data.isAmber ? 'amber' : 'idle'}`} />
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="scifi-handle"
        style={{ right: '-6px' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom-source"
        className="scifi-handle scifi-handle-source-amber"
        style={{ left: '70%', bottom: '-6px' }}
      />
    </div>
  );
};

const nodeTypes = { persona: PersonaNode };

/**
 * D-S3.7 — typed SSE/WS heartbeat events the visualizer renders live.
 *   { type: "turn",     role: "EXECUTOR", ts: 1712345678901 }
 *   { type: "complete", state: <AgentState>, ts }
 */
export interface AgentLiveEvent {
  type: "turn" | "complete";
  role?: string;
  state?: AgentState;
  ts: number;
}

interface AgentVisualizerProps {
  agentState: AgentState | null;
  isLoading: boolean;
  streamingContent?: { persona: string; content: string } | null;
  liveEvents?: AgentLiveEvent[];
  onSendPrompt: (prompt: string) => void;
  onMerge: () => void;
  onResume: (ticketId: string) => void;
}

export const AgentVisualizer: React.FC<AgentVisualizerProps> = ({
  agentState,
  isLoading,
  streamingContent,
  liveEvents = [],
  onSendPrompt,
  onMerge,
  onResume,
}) => {
  const [customPrompt, setCustomPrompt] = useState("");
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  
  // Built-in presets
  const presets = [
    { tag: "CMD-01", label: "1. Read Query", prompt: "how many forms do we have?" },
    { tag: "CMD-02", label: "2. Vague Build", prompt: "lets build a form." },
    { tag: "CMD-03", label: "3. Detailed Build", prompt: "build a feedback form with Full Name, Email, and Star Rating" },
    { tag: "CMD-04", label: "4. Destructive", prompt: "delete test form" },
  ];
  
  // R8.1: Custom presets state
  const [customPresets, setCustomPresets] = useState<Array<{ id: string; label: string; prompt: string; tags: string[] }>>([]);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [newPresetLabel, setNewPresetLabel] = useState("");
  const [newPresetPrompt, setNewPresetPrompt] = useState("");
  const [newPresetTags, setNewPresetTags] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);
  
  // R8.2: Budget configuration
  const PER_TICKET_BUDGET = 50000;
  const PER_USER_DAY_BUDGET = 200000;
  const BUDGET_BYPASS_USERS = process.env.NEXT_PUBLIC_BUDGET_BYPASS_USERS?.split(",") || [];

  // R8.1: Fetch custom presets on mount
  React.useEffect(() => {
    const fetchPresets = async () => {
      try {
        const res = await fetch("/api/agent/presets");
        if (res.ok) {
          const data = await res.json();
          setCustomPresets(data.presets || []);
        }
      } catch (e) {
        console.error("Failed to fetch presets:", e);
      }
    };
    fetchPresets();
  }, []);

  // R8.1: Save preset
  const savePreset = async () => {
    if (!newPresetLabel.trim() || !newPresetPrompt.trim()) return;
    setSavingPreset(true);
    try {
      const res = await fetch("/api/agent/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newPresetLabel.trim(),
          prompt: newPresetPrompt.trim(),
          tags: newPresetTags.split(",").map(t => t.trim()).filter(Boolean),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setCustomPresets(prev => [data.preset, ...prev]);
        setNewPresetLabel("");
        setNewPresetPrompt("");
        setNewPresetTags("");
        setShowPresetModal(false);
      }
    } catch (e) {
      console.error("Failed to save preset:", e);
    } finally {
      setSavingPreset(false);
    }
  };

  // R8.1: Delete preset
  const deletePreset = async (id: string) => {
    try {
      await fetch(`/api/agent/presets/${id}`, { method: "DELETE" });
      setCustomPresets(prev => prev.filter(p => p.id !== id));
    } catch (e) {
      console.error("Failed to delete preset:", e);
    }
  };

  // R8.1: Save current prompt as preset
  const saveCurrentPromptAsPreset = () => {
    if (customPrompt.trim()) {
      setNewPresetLabel(`Custom ${new Date().toLocaleTimeString()}`);
      setNewPresetPrompt(customPrompt);
      setShowPresetModal(true);
    }
  };

  // R8.2: Calculate budget usage
  const getBudgetUsage = () => {
    if (!agentState?.tokenUsage) return { used: 0, total: PER_TICKET_BUDGET, percentage: 0 };
    const used = agentState.tokenUsage.total;
    const total = PER_TICKET_BUDGET;
    return { used, total, percentage: Math.min(100, (used / total) * 100) };
  };

  // R8.2: Check if budget exceeded
  const isBudgetExceeded = () => {
    if (!agentState?.tokenUsage) return false;
    const bypassUsers = BUDGET_BYPASS_USERS;
    // Note: would need userId from context to check bypass
    return agentState.tokenUsage.total >= PER_TICKET_BUDGET;
  };

  // R8.2: Get daily budget usage (would need API call for real data)
  const getDailyBudgetUsage = () => {
    // Placeholder - would need API call to get actual daily usage
    return { used: 0, total: PER_USER_DAY_BUDGET, percentage: 0 };
  };

  const nodes = useMemo(() => [
    // --- System Level Nodes ---
    {
      id: 'client', type: 'persona', position: { x: 40, y: 0 },
      data: {
        subTag: 'SYS.CLIENT',
        icon: '🧑‍💻',
        label: 'BROWSER UI',
        desc: 'User Interface',
        isSystem: true,
        isActive: false,
      }
    },
    {
      id: 'agent_core', type: 'persona', position: { x: 520, y: 0 },
      data: {
        subTag: 'SYS.CORE',
        icon: '🧠',
        label: 'AGENT CORE',
        desc: 'Main Orchestrator',
        isSystem: true,
        isActive: !!agentState?.activePersona,
      }
    },
    {
      id: 'server_llm', type: 'persona', position: { x: 1000, y: 0 },
      data: {
        subTag: 'SYS.LLM',
        icon: '☁️',
        label: 'SERVER LLM',
        desc: 'Language Model API',
        isSystem: true,
        isActive: !!agentState?.activePersona && agentState?.activePersona !== "EXECUTOR_SANDBOX",
      }
    },
    // --- Persona Level Nodes ---
    {
      id: 'drafter', type: 'persona', position: { x: 40, y: 180 },
      data: {
        subTag: 'NEXUS.PRSN-01',
        icon: '🔍',
        label: '1. DRAFTER',
        desc: 'Prompt Digestion\n& Intent Check',
        isActive: agentState?.activePersona === "DRAFTER",
        isAmber: false,
      }
    },
    {
      id: 'planner', type: 'persona', position: { x: 280, y: 180 },
      data: {
        subTag: 'NEXUS.PRSN-02',
        icon: '📝',
        label: '2. PLANNER',
        desc: 'Action Plan\nCompiler',
        isActive: agentState?.activePersona === "PLANNER",
        isAmber: false,
      }
    },
    {
      id: 'executor', type: 'persona', position: { x: 520, y: 180 },
      data: {
        subTag: 'NEXUS.PRSN-03',
        icon: '⚙️',
        label: '3. EXECUTOR',
        desc: 'Isolated Sandbox\nTool Run',
        isActive: agentState?.activePersona === "EXECUTOR_SANDBOX",
        isAmber: agentState?.activePersona === "EXECUTOR_SANDBOX",
      }
    },
    {
      id: 'evaluator', type: 'persona', position: { x: 760, y: 180 },
      data: {
        subTag: 'NEXUS.PRSN-04',
        icon: '🧪',
        label: '4. EVALUATOR',
        desc: 'QA Check &\nLoop Control',
        isActive: agentState?.activePersona === "EVALUATOR",
        isAmber: false,
      }
    },
    {
      id: 'communicator', type: 'persona', position: { x: 1000, y: 180 },
      data: {
        subTag: 'NEXUS.PRSN-05',
        icon: '💬',
        label: '5. COMMUNICATOR',
        desc: 'Format Final\nClient Reply',
        isActive: agentState?.activePersona === "COMMUNICATOR",
        isAmber: false,
      }
    }
  ], [agentState?.activePersona]);

  const edges = useMemo(() => [
    // --- System Edges ---
    {
      id: 'e-client-core', source: 'client', sourceHandle: 'right', target: 'agent_core', targetHandle: 'left',
      animated: !!agentState?.activePersona,
      style: { stroke: '#c084fc', strokeWidth: 2, filter: !!agentState?.activePersona ? 'drop-shadow(0 0 8px #c084fc)' : 'none' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#c084fc' }
    },
    {
      id: 'e-core-llm', source: 'agent_core', sourceHandle: 'right', target: 'server_llm', targetHandle: 'left',
      animated: !!agentState?.activePersona && agentState?.activePersona !== "EXECUTOR_SANDBOX",
      style: { stroke: '#c084fc', strokeWidth: 2, filter: (!!agentState?.activePersona && agentState?.activePersona !== "EXECUTOR_SANDBOX") ? 'drop-shadow(0 0 8px #c084fc)' : 'none' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#c084fc' }
    },
    {
      id: 'e-core-drafter', source: 'agent_core', sourceHandle: 'bottom-source', target: 'drafter', targetHandle: 'top',
      type: 'smoothstep',
      animated: agentState?.activePersona === "DRAFTER",
      style: { stroke: agentState?.activePersona === "DRAFTER" ? '#38bdf8' : '#1e293b', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: agentState?.activePersona === "DRAFTER" ? '#38bdf8' : '#334155' }
    },
    {
      id: 'e-communicator-core', source: 'communicator', sourceHandle: 'top-source', target: 'agent_core', targetHandle: 'bottom-target',
      type: 'smoothstep',
      animated: agentState?.activePersona === "COMMUNICATOR" && agentState?.isComplete,
      style: { stroke: (agentState?.activePersona === "COMMUNICATOR" && agentState?.isComplete) ? '#10b981' : '#1e293b', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: (agentState?.activePersona === "COMMUNICATOR" && agentState?.isComplete) ? '#10b981' : '#334155' }
    },
    // --- Persona Edges ---
    {
      id: 'e1-2', source: 'drafter', sourceHandle: 'right', target: 'planner', targetHandle: 'left',
      animated: agentState?.activePersona === "PLANNER",
      style: {
        stroke: agentState?.activePersona === "PLANNER" ? '#38bdf8' : '#1e293b',
        strokeWidth: agentState?.activePersona === "PLANNER" ? 4 : 2,
        filter: agentState?.activePersona === "PLANNER" ? 'drop-shadow(0 0 8px #38bdf8)' : 'none'
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: agentState?.activePersona === "PLANNER" ? '#38bdf8' : '#334155' }
    },
    {
      id: 'e2-3', source: 'planner', sourceHandle: 'right', target: 'executor', targetHandle: 'left',
      animated: agentState?.activePersona === "EXECUTOR_SANDBOX",
      style: {
        stroke: agentState?.activePersona === "EXECUTOR_SANDBOX" ? '#38bdf8' : '#1e293b',
        strokeWidth: agentState?.activePersona === "EXECUTOR_SANDBOX" ? 4 : 2,
        filter: agentState?.activePersona === "EXECUTOR_SANDBOX" ? 'drop-shadow(0 0 8px #38bdf8)' : 'none'
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: agentState?.activePersona === "EXECUTOR_SANDBOX" ? '#38bdf8' : '#334155' }
    },
    {
      id: 'e3-4', source: 'executor', sourceHandle: 'right', target: 'evaluator', targetHandle: 'left',
      animated: agentState?.activePersona === "EVALUATOR",
      style: {
        stroke: agentState?.activePersona === "EVALUATOR" ? '#38bdf8' : '#1e293b',
        strokeWidth: agentState?.activePersona === "EVALUATOR" ? 4 : 2,
        filter: agentState?.activePersona === "EVALUATOR" ? 'drop-shadow(0 0 8px #38bdf8)' : 'none'
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: agentState?.activePersona === "EVALUATOR" ? '#38bdf8' : '#334155' }
    },
    {
      id: 'e4-5', source: 'evaluator', sourceHandle: 'right', target: 'communicator', targetHandle: 'left',
      animated: agentState?.activePersona === "COMMUNICATOR",
      style: {
        stroke: agentState?.activePersona === "COMMUNICATOR" ? '#38bdf8' : '#1e293b',
        strokeWidth: agentState?.activePersona === "COMMUNICATOR" ? 4 : 2,
        filter: agentState?.activePersona === "COMMUNICATOR" ? 'drop-shadow(0 0 8px #38bdf8)' : 'none'
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: agentState?.activePersona === "COMMUNICATOR" ? '#38bdf8' : '#334155' }
    },
    {
      id: 'e4-3', source: 'evaluator', sourceHandle: 'bottom-source', target: 'executor', targetHandle: 'bottom-target',
      type: 'smoothstep',
      animated: agentState?.activePersona === "EXECUTOR_SANDBOX",
      style: {
        stroke: agentState?.activePersona === "EXECUTOR_SANDBOX" ? '#f59e0b' : '#1e293b',
        strokeWidth: agentState?.activePersona === "EXECUTOR_SANDBOX" ? 4 : 2,
        strokeDasharray: '6,6',
        filter: agentState?.activePersona === "EXECUTOR_SANDBOX" ? 'drop-shadow(0 0 8px #f59e0b)' : 'none'
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: agentState?.activePersona === "EXECUTOR_SANDBOX" ? '#f59e0b' : '#334155' }
    }
  ], [agentState?.activePersona, agentState?.isComplete]);

  return (
    <div className="scifi-agent-page">

      {/* Ambient Glow Effects */}
      <div className="scifi-glow-orb-1" />
      <div className="scifi-glow-orb-2" />

      {/* Cybernetic HUD Header Bar */}
      <header className="scifi-header">

        {/* Brand Logo & Title */}
        <div className="scifi-brand-area">
          <div className="scifi-brand-logo">
            ⚡
            <span className={`scifi-status-dot ${isOnline ? 'online' : 'offline'}`} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 className="scifi-brand-title">
                EASY FORMS // NEXUS AI CORE v5.0
              </h1>
              <span className="scifi-badge-autonomous">AUTONOMOUS</span>
            </div>

            {/* Header Telemetry stats */}
            <div className="scifi-header-telemetry">
              <span>
                NEURAL LINK: <strong style={{ color: isOnline ? '#10b981' : '#ef4444' }}>
                  {isOnline ? 'ONLINE / SYNCHRONIZED' : 'OFFLINE'}
                </strong>
              </span>
              <span>|</span>
              <span>LATENCY: <strong style={{ color: '#38bdf8' }}>12ms</strong></span>
              <span>|</span>
              <span>QUANTUM CORE: <strong style={{ color: '#c084fc' }}>ACTIVE</strong></span>
            </div>

            {/* R8.2: Token Budget Progress Bar */}
            <div style={{ marginTop: '8px', padding: '4px 8px', background: 'rgba(30, 41, 59, 0.6)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '4px' }}>
              {(() => {
                const { used, total, percentage } = getBudgetUsage();
                const isWarning = percentage >= 80;
                const isDanger = percentage >= 100;
                const isExceeded = isBudgetExceeded();
                return (
                  <div style={{ fontSize: '10px', fontFamily: 'monospace', fontWeight: 600 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <span>TOKEN BUDGET</span>
                      <span style={{ color: isDanger ? '#ef4444' : isWarning ? '#fbbf24' : '#38bdf8' }}>
                        {used.toLocaleString()} / {total.toLocaleString()} ({percentage.toFixed(1)}%)
                      </span>
                    </div>
                    <div style={{ height: '4px', background: 'rgba(30, 41, 59, 0.8)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${Math.min(100, percentage)}%`,
                          height: '100%',
                          background: isDanger ? 'linear-gradient(90deg, #ef4444, #f87171)' : 
                                   isWarning ? 'linear-gradient(90deg, #fbbf24, #fde047)' : 
                                   'linear-gradient(90deg, #38bdf8, #0ea5e9)',
                          borderRadius: '2px',
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                    {isExceeded && (
                      <span style={{ color: '#ef4444', fontSize: '9px', fontWeight: 700, marginTop: '2px', display: 'block' }}>
                        ⚠ BUDGET EXCEEDED — Request blocked
                      </span>
                    )}
                    {isWarning && !isDanger && !isExceeded && (
                      <span style={{ color: '#fbbf24', fontSize: '9px', fontWeight: 700, marginTop: '2px', display: 'block' }}>
                        ⚠ APPROACHING BUDGET LIMIT
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Security Clearance Ticket Badge */}
        {agentState?.ticket && (
          <div className="scifi-ticket-badge">
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '9px', fontFamily: 'monospace', color: 'rgba(192, 132, 252, 0.8)', fontWeight: 700, letterSpacing: '1px' }}>
                SECURITY TICKET CLEARANCE
              </div>
              <div style={{ fontSize: '12px', fontFamily: 'monospace', fontWeight: 900, color: '#7dd3fc' }}>
                #{agentState.ticket.ticketId}
              </div>
            </div>

            <div className={`scifi-ticket-stage-tag ${agentState.ticket.stage}`}>
              {agentState.ticket.stage.replace('_', ' ')}
            </div>
          </div>
        )}
      </header>

      {/* Main Workspace Area */}
      <div className="scifi-workspace">

        {/* Left Mission Control Sidebar Console */}
        <aside className="scifi-sidebar">

          {/* Header Title */}
          <div className="scifi-section-title">
            <span>⚡ MISSION CONTROL CONSOLE</span>
            <span style={{ fontSize: '9px', color: '#64748b' }}>SYS.PRST v5</span>
          </div>

          {/* Presets Grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#94a3b8', fontWeight: 600, letterSpacing: '1px' }}>
                PRESET COMMAND STREAMS
              </div>
              <button
                onClick={() => saveCurrentPromptAsPreset()}
                disabled={isLoading || !isOnline || !customPrompt.trim()}
                className="scifi-btn-small"
                style={{ fontSize: '8px', padding: '2px 6px' }}
              >
                ➕ SAVE AS PRESET
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {/* Built-in presets */}
              {presets.map((p, idx) => (
                <div
                  key={`builtin-${idx}`}
                  onClick={() => {
                    if (!isLoading && isOnline) onSendPrompt(p.prompt);
                  }}
                  className={`scifi-preset-card ${isLoading || !isOnline ? 'disabled' : ''}`}
                >
                  <div className="scifi-preset-header">
                    <span className="scifi-preset-label">{p.label}</span>
                    <span className="scifi-preset-tag">{p.tag}</span>
                  </div>
                  <div className="scifi-preset-prompt">{p.prompt}</div>
                </div>
              ))}

              {/* Custom presets from API */}
              {customPresets.length > 0 && (
                <>
                  <hr style={{ borderColor: 'rgba(30, 41, 59, 0.8)', borderStyle: 'dashed', borderWidth: '1px 0 0 0', margin: '8px 0' }} />
                  <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#38bdf8', fontWeight: 600, letterSpacing: '1px', marginBottom: '6px' }}>
                    CUSTOM PRESETS
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {customPresets.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => {
                          if (!isLoading && isOnline) onSendPrompt(p.prompt);
                        }}
                        className={`scifi-preset-card ${isLoading || !isOnline ? 'disabled' : ''}`}
                        style={{ position: 'relative' }}
                      >
                        <div className="scifi-preset-header">
                          <span className="scifi-preset-label">{p.label}</span>
                          <span className="scifi-preset-tag">CUSTOM</span>
                        </div>
                        <div className="scifi-preset-prompt">{p.prompt}</div>
                        {p.tags.length > 0 && (
                          <div style={{ fontSize: '8px', color: '#64748b', marginTop: '4px' }}>
                            {p.tags.map(t => <span key={t} style={{ marginRight: '4px', padding: '1px 4px', background: 'rgba(56, 189, 248, 0.2)', borderRadius: '2px' }}>{t}</span>)}
                          </div>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete preset "${p.label}"?`)) deletePreset(p.id);
                          }}
                          style={{
                            position: 'absolute',
                            top: '4px',
                            right: '4px',
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            background: 'rgba(239, 68, 68, 0.2)',
                            border: '1px solid rgba(239, 68, 68, 0.4)',
                            color: '#ef4444',
                            fontSize: '10px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <hr style={{ borderColor: 'rgba(30, 41, 59, 0.8)', borderStyle: 'solid', borderWidth: '1px 0 0 0' }} />

          {/* Prompt Injection Terminal */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#94a3b8', fontWeight: 600, letterSpacing: '1px' }}>
              QUANTUM PROMPT INJECTOR
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (customPrompt.trim() && !isLoading && isOnline) {
                  onSendPrompt(customPrompt);
                  setCustomPrompt("");
                }
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              <textarea
                placeholder="Enter command prompt for AI Core execution..."
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                className="scifi-input-textarea"
              />

              <button
                type="submit"
                disabled={isLoading || !isOnline}
                className="scifi-btn-transmit"
              >
                {isLoading ? "TRANSMITTING..." : !isOnline ? "CORE OFFLINE" : "⚡ TRANSMIT COMMAND TO CORE"}
              </button>
            </form>
          </div>

          <hr style={{ borderColor: 'rgba(30, 41, 59, 0.8)', borderStyle: 'solid', borderWidth: '1px 0 0 0' }} />

          {/* Fault Simulator */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="scifi-section-title" style={{ border: 'none', padding: 0 }}>
              <span style={{ color: '#fbbf24' }}>☣️ FAULT SIMULATOR</span>
              <span style={{ fontSize: '8px', color: '#64748b' }}>RECURSION TEST</span>
            </div>

            <p style={{ fontSize: '10px', color: '#94a3b8', lineHeight: 1.4 }}>
              Inject emergency shutdown signal to test database snapshot & recovery mechanics.
            </p>

            <button
              onClick={async () => {
                const willSimulate = isOnline;
                await fetch("/api/agent/simulate-offline", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ simulateOffline: willSimulate })
                });
              }}
              className={`scifi-btn-fault ${isOnline ? 'fault-trigger' : 'fault-restore'}`}
            >
              {isOnline ? "⚠️ SIMULATE CORE FAILURE" : "⚡ RESTORE CORE SYSTEM"}
            </button>
          </div>

        </aside>

        {/* Center / Main Content Area */}
        <main className="scifi-main-content">

          {/* Notification Overlay Modals */}
          {(agentState?.isComplete && agentState.activePersona === "AWAITING_USER_APPROVAL") && (
            <div className="scifi-modal-container">
              <div className="scifi-modal-approval">
                <div>
                  <div style={{ fontSize: '13px', fontFamily: 'monospace', fontWeight: 900, color: '#34d399' }}>
                    🎉 EVALUATION PASSED // READY FOR MERGE
                  </div>
                  <div style={{ fontSize: '11px', color: '#a7f3d0', marginTop: '2px' }}>
                    Sandbox state verified by QA evaluator. Ready to merge into production database.
                  </div>
                </div>

                <button onClick={onMerge} className="scifi-btn-approve">
                  APPROVE & MERGE
                </button>
              </div>
            </div>
          )}

          {agentState?.ticket?.status === "LLM_ERROR" && (
            <div className="scifi-modal-container">
              <div className="scifi-modal-error">
                <div>
                  <div style={{ fontSize: '13px', fontFamily: 'monospace', fontWeight: 900, color: '#fbbf24' }}>
                    ⚠️ FATAL EXCEPTION ENCOUNTERED
                  </div>
                  <div style={{ fontSize: '11px', color: '#fde68a', marginTop: '2px' }}>
                    Agent crashed at persona <span style={{ fontWeight: 700 }}>{agentState.activePersona}</span>. State captured in DB.
                  </div>
                </div>

                <button
                  onClick={() => onResume(agentState.ticket.ticketId)}
                  disabled={isLoading || !isOnline}
                  className="scifi-btn-resume"
                >
                  {isLoading ? "RECOVERING..." : !isOnline ? "CORE OFFLINE" : "RECOVER & RESUME"}
                </button>
              </div>
            </div>
          )}

          {/* ReactFlow Canvas Area */}
          <div className="scifi-canvas-wrapper">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              proOptions={{ hideAttribution: true }}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              style={{ width: '100%', height: '100%' }}
            >
              <Background color="#38bdf8" gap={32} size={1} className="opacity-15" />
            </ReactFlow>
          </div>

          {/* D-S3.7 — Typed Heartbeat Rail (turn / complete SSE events) */}
          {liveEvents.length > 0 && (
            <div className="scifi-heartbeat-rail">
              <div className="scifi-heartbeat-title">♢ HEARTBEAT</div>
              <div className="scifi-heartbeat-list custom-scrollbar">
                {liveEvents.slice(-24).map((evt, i) => (
                  <div key={`${evt.ts}-${i}`} className="scifi-heartbeat-item">
                    <span className="scifi-heartbeat-type">
                      {evt.type === "turn" ? "TURN" : "COMPLETE"}
                    </span>
                    <span className="scifi-heartbeat-role">{evt.role ?? evt.state?.activePersona ?? "—"}</span>
                    <span className="scifi-heartbeat-ts">{new Date(evt.ts).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom Dock (Agent Neural Comm-Link) */}
          <div className="scifi-dock">

            {/* Memory & Context Pane */}
            <div className="scifi-pane-memory" style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(30, 41, 59, 0.8)', minWidth: 0 }}>
              <div className="scifi-pane-header">
                <span>🧠 AGENT WORKING MEMORY</span>
              </div>
              <div className="scifi-pane-body" style={{ overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>

                {/* Requirements */}
                {agentState?.requirements && Object.keys(agentState.requirements).length > 0 && (
                  <div className="scifi-memory-block">
                    <div className="scifi-memory-title">EXTRACTED REQUIREMENTS</div>
                    <pre className="scifi-payload-pre">
                      {JSON.stringify(agentState.requirements, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Current Action Plan */}
                {agentState?.actionPlan && agentState.actionPlan.length > 0 && (
                  <div className="scifi-memory-block">
                    <div className="scifi-memory-title">ACTION PLAN</div>
                    <pre className="scifi-payload-pre">
                      {JSON.stringify(agentState.actionPlan.map((p: any) => ({ tool: p.tool, desc: p.description, status: p.status })), null, 2)}
                    </pre>
                  </div>
                )}

                {(!agentState?.requirements || Object.keys(agentState.requirements).length === 0) && (!agentState?.actionPlan || agentState.actionPlan.length === 0) && (
                  <div style={{ color: '#475569', fontSize: '12px', fontStyle: 'italic', textAlign: 'center', marginTop: '20px' }}>
                    Memory banks empty.
                  </div>
                )}
              </div>
            </div>

            <div className="scifi-pane-chat" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div className="scifi-pane-header">
                <span>📡 AGENT NEURAL COMM-LINK</span>
                <span style={{ fontSize: '9px', color: '#64748b' }}>
                  {agentState?.executionTrace?.length || 0} MESSAGES
                </span>
              </div>

              <div className="scifi-pane-body agent-chat-container">
                {(!agentState?.executionTrace || agentState.executionTrace.length === 0) && !streamingContent ? (
                  <div style={{ color: '#475569', fontSize: '12px', fontStyle: 'italic', textAlign: 'center', marginTop: '40px' }}>
                    Comm-link standing by. Awaiting agent transmissions...
                  </div>
                ) : (
                  <>
                    {agentState?.executionTrace?.map((trc: ExecutionTraceStep) => {
                      const isExpanded = expandedLogId === trc.stepId;

                      const avatars: Record<string, string> = {
                        DRAFTER: "🔍",
                        PLANNER: "📝",
                        EXECUTOR_SANDBOX: "⚙️",
                        EVALUATOR: "🧪",
                        COMMUNICATOR: "💬",
                        AWAITING_USER_APPROVAL: "🧑‍💻",
                      };
                      const avatar = avatars[trc.persona] || "🤖";

                      return (
                        <div key={trc.stepId} className="agent-chat-bubble-wrapper">
                          <div className={`agent-chat-avatar ${trc.persona}`}>
                            {avatar}
                          </div>
                          <div className="agent-chat-content">
                            <div className="agent-chat-meta">
                              <span className={`agent-chat-sender ${trc.persona}`}>{trc.persona.replace("_", " ")}</span>
                              <span className="agent-chat-time">{trc.timestamp.split('T')[1]?.split('.')[0] || trc.timestamp}</span>
                            </div>

                            <div className={`agent-chat-bubble ${trc.persona}`}>
                              <div className="agent-chat-message">{trc.message}</div>

                              {trc.payload && (
                                <div style={{ marginTop: '8px' }}>
                                  <span
                                    onClick={() => setExpandedLogId(isExpanded ? null : trc.stepId)}
                                    style={{ fontSize: '9px', fontWeight: 700, color: 'inherit', cursor: 'pointer', opacity: 0.8 }}
                                  >
                                    {isExpanded ? '[-] HIDE DETAILS' : '[+] VIEW DETAILS'}
                                  </span>
                                  {isExpanded && (
                                    <pre className="scifi-payload-pre">
                                      {JSON.stringify(trc.payload, null, 2)}
                                    </pre>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {streamingContent && (
                      <div className="agent-chat-bubble-wrapper">
                        <div className={`agent-chat-avatar ${streamingContent.persona}`}>
                          {({
                            DRAFTER: "🔍",
                            PLANNER: "📝",
                            EXECUTOR_SANDBOX: "⚙️",
                            EVALUATOR: "🧪",
                            COMMUNICATOR: "💬",
                            AWAITING_USER_APPROVAL: "🧑‍💻",
                          } as Record<string, string>)[streamingContent.persona] || "🤖"}
                        </div>
                        <div className="agent-chat-content">
                          <div className="agent-chat-meta">
                            <span className={`agent-chat-sender ${streamingContent.persona}`}>{streamingContent.persona.replace("_", " ")}</span>
                            <span className="agent-chat-time" style={{ color: '#34d399', animation: 'pulse 1.5s infinite' }}>Thinking...</span>
                          </div>
                          <div className={`agent-chat-bubble ${streamingContent.persona}`} style={{ opacity: 0.8 }}>
                            <pre className="scifi-payload-pre" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', borderLeft: '2px solid #38bdf8' }}>
                              {streamingContent.content}
                              <span style={{ display: 'inline-block', width: '6px', height: '14px', backgroundColor: '#38bdf8', marginLeft: '4px', verticalAlign: 'middle', animation: 'blink 1s step-end infinite' }} />
                            </pre>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

</div>
        </main>
      </div>

      {/* R8.1: Save Preset Modal */}
      {showPresetModal && (
        <div className="scifi-modal-overlay" onClick={() => setShowPresetModal(false)}>
          <div className="scifi-modal" onClick={(e) => e.stopPropagation()}>
            <div className="scifi-modal-header">
              <span>💾 SAVE AS PRESET</span>
              <button onClick={() => setShowPresetModal(false)} className="scifi-modal-close">✕</button>
            </div>
            <div className="scifi-modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '9px', fontFamily: 'monospace', color: '#94a3b8', marginBottom: '4px' }}>
                    PRESET LABEL
                  </label>
                  <input
                    type="text"
                    value={newPresetLabel}
                    onChange={(e) => setNewPresetLabel(e.target.value)}
                    placeholder="e.g., Weekly Feedback Form"
                    className="scifi-input"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '9px', fontFamily: 'monospace', color: '#94a3b8', marginBottom: '4px' }}>
                    PROMPT
                  </label>
                  <textarea
                    value={newPresetPrompt}
                    onChange={(e) => setNewPresetPrompt(e.target.value)}
                    placeholder="Enter the prompt to save as preset..."
                    className="scifi-input-textarea"
                    style={{ minHeight: '80px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '9px', fontFamily: 'monospace', color: '#94a3b8', marginBottom: '4px' }}>
                    TAGS (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={newPresetTags}
                    onChange={(e) => setNewPresetTags(e.target.value)}
                    placeholder="e.g., feedback, survey, weekly"
                    className="scifi-input"
                  />
                </div>
              </div>
            </div>
            <div className="scifi-modal-footer">
              <button onClick={() => setShowPresetModal(false)} className="scifi-btn-cancel">CANCEL</button>
              <button onClick={savePreset} disabled={savingPreset || !newPresetLabel.trim() || !newPresetPrompt.trim()} className="scifi-btn-save">
                {savingPreset ? "SAVING..." : "💾 SAVE PRESET"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
