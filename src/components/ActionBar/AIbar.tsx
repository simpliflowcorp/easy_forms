"use client";
import { useLanguageStore } from "@/store/store";
import { useSession } from "next-auth/react";
import React, { useState } from "react";
import toast from "react-hot-toast";
import { AgentAction, AgentState } from "@/agent/types";
import { AgentConfirmationModal } from "./AgentConfirmationModal";
import { CustomTableViewModal } from "./CustomTableViewModal";
import { AgentSidebarDrawer } from "./AgentSidebarDrawer";

type Props = {
  activeFormId?: string;
  activeFormName?: string;
};

const AIbar = ({ activeFormId, activeFormName }: Props) => {
  const lang = useLanguageStore((state) => state.language);
  const session = useSession();

  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
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

  // UI State Dispatchers based on Stage 1, Stage 2, Stage 3 Tickets
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [confirmationModalOpen, setConfirmationModalOpen] = useState(false);
  const [stage3Action, setStage3Action] = useState<AgentAction | null>(null);

  // Read-only Table modal state
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [tableData, setTableData] = useState<any>(null);

  const handleAIChat = async (userPrompt: string, mergeApproved: boolean = false) => {
    if (!userPrompt.trim() && !mergeApproved) return;
    setIsLoading(true);

    try {
      const res = await fetch("/api/agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: userPrompt,
          mergeApproved,
        }),
      });

      const stateData: AgentState = await res.json();
      setIsLoading(false);
      setAgentState(stateData);

      const ticketStage = stateData.ticket?.stage || "STAGE_1";

      // Dispatch UI based on Ticket Stage
      if (ticketStage === "STAGE_1") {
        // Stage 1: Quick Toast Notification (Read queries, lookups, routing)
        talkBack(stateData.reply || stateData.drafterMessage || "Query lookup complete!");
      } else if (ticketStage === "STAGE_2") {
        // Stage 2: Open Slide-Over Sidebar Chat Drawer
        setSidebarOpen(true);
        if (stateData.reply) {
          talkBack(stateData.reply);
        }
      } else if (ticketStage === "STAGE_3") {
        // Stage 3: Open Confirmation Modal with Backup Suggestions
        const deleteAct: AgentAction = {
          id: `act_${Date.now()}`,
          tool: "delete_form",
          description: `Delete form request: "${userPrompt}"`,
          params: { formId: activeFormId },
          status: "awaiting_confirmation",
        };
        setStage3Action(deleteAct);
        setConfirmationModalOpen(true);
      }

      // Check if query_responses tool was executed to open table modal
      const queryAction = stateData.actionPlan?.find((a) => a.tool === "query_responses" && a.status === "done");
      if (queryAction && queryAction.result) {
        setTableData(queryAction.result);
        setTableModalOpen(true);
      }
    } catch (err: any) {
      setIsLoading(false);
      talkBack("Failed to connect to AI Agent service");
      toast.error("Agent execution error");
    }
  };

  const handleConfirmStage3 = async () => {
    setConfirmationModalOpen(false);
    talkBack("Executing Stage 3 delete action...");
    try {
      const res = await fetch("/api/agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `delete form ${activeFormId}`,
          directExecute: true,
          tool: "delete_form",
          params: { formId: activeFormId },
          confirmToken: "APPROVED",
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Form deleted successfully");
      } else {
        toast.error(`Delete failed: ${data.error}`);
      }
    } catch (e: any) {
      toast.error("Delete execution error");
    }
  };

  const talkBack = (message: string) => {
    toast.dismiss();
    toast((t) => <span onClick={() => toast.dismiss(t.id)}>{message}</span>, {
      position: "bottom-right",
      duration: 5000,
      style: {
        background: "#0f172a",
        color: "#38bdf8",
        border: "1px solid #0284c7",
        padding: "10px 20px",
        marginBottom: "50px",
        borderRadius: "8px",
        fontSize: "14px",
      },
    });
  };

  const latestAssistantMessage = agentState?.reply || agentState?.evaluatorFeedback;

  return (
    <div className="w-full flex flex-col items-center gap-2">
      {/* Robotic Input Bar */}
      <div className="ai-bar flex items-center gap-3 w-full bg-slate-900/90 border border-cyan-500/30 p-3 rounded-2xl shadow-xl backdrop-blur-md">
        <div className="ai-input-section flex-1">
          <input
            disabled={isLoading || !isOnline}
            onKeyDown={(e) => {
              if (e.key === "Enter" && prompt.trim() !== "" && isOnline) {
                handleAIChat(prompt);
                setPrompt("");
              }
            }}
            placeholder={isOnline ? "Type prompt (e.g. 'how many responses?', 'build a form', 'delete form')..." : "AI Engine is offline. Start Ollama."}
            className="ai-input w-full bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:border-cyan-500 transition-all"
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        {!isOnline ? (
          <div className="ai-face flex items-center justify-center gap-1.5 px-3 cursor-not-allowed opacity-50" title="AI Offline">
            <div className="eye eye_left w-3 h-1 rounded-full bg-slate-500"></div>
            <div className="eye eye_right w-3 h-1 rounded-full bg-slate-500"></div>
          </div>
        ) : isLoading ? (
          <div className="ai-face flex items-center justify-center gap-1.5 px-3 cursor-wait">
            <div className="eye eye_left loading w-3 h-3 rounded-full bg-cyan-400 animate-ping"></div>
            <div className="eye eye_right loading w-3 h-3 rounded-full bg-cyan-400 animate-ping"></div>
          </div>
        ) : (
          <div
            onClick={() => {
              if (prompt.trim()) {
                handleAIChat(prompt);
                setPrompt("");
              }
            }}
            className="ai-face flex items-center justify-center gap-1.5 px-3 cursor-pointer hover:scale-105 transition-transform"
            title="Submit to AI Agent"
          >
            <div className="eye eye_left w-3 h-3 rounded-full bg-cyan-400"></div>
            <div className="eye eye_right w-3 h-3 rounded-full bg-cyan-400"></div>
          </div>
        )}
      </div>

      {/* STAGE 2: Slide-Over Sidebar Chat Drawer */}
      <AgentSidebarDrawer
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        agentState={agentState}
        latestMessage={latestAssistantMessage}
        onMerge={() => handleAIChat("", true)}
        onSendPrompt={(p) => handleAIChat(p)}
      />

      {/* STAGE 3: Confirmation Modal with Backup Suggestions */}
      <AgentConfirmationModal
        isOpen={confirmationModalOpen}
        action={stage3Action}
        formId={activeFormId}
        onConfirm={handleConfirmStage3}
        onCancel={() => setConfirmationModalOpen(false)}
      />

      {/* Read-Only Responses Table Modal */}
      {tableModalOpen && activeFormId && (
        <CustomTableViewModal
          isOpen={tableModalOpen}
          onClose={() => setTableModalOpen(false)}
          formId={activeFormId}
          formName={activeFormName}
          initialData={tableData}
        />
      )}
    </div>
  );
};

export default AIbar;
