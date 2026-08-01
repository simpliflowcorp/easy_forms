"use client";
import { useLanguageStore, useAgentStore } from "@/store/store";
import { useSession } from "next-auth/react";
import React, { useState } from "react";
import toast from "react-hot-toast";
import { AgentAction, AgentState } from "@/agent/types";
import { AgentConfirmationModal } from "./AgentConfirmationModal";
import { CustomTableViewModal } from "./CustomTableViewModal";
import { AgentSidebarDrawer } from "./AgentSidebarDrawer";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type Props = {
  activeFormId?: string;
  activeFormName?: string;
};

const TypewriterSpeechBubble = ({ text, onClose }: { text: string; onClose: () => void }) => {
  const [displayedText, setDisplayedText] = useState("");

  React.useEffect(() => {
    let i = 0;
    setDisplayedText("");
    if (!text) return;

    const interval = setInterval(() => {
      if (i < text.length) {
        setDisplayedText(text.slice(0, i + 1));
        i++;
      } else {
        clearInterval(interval);
      }
    }, 30);

    return () => clearInterval(interval);
  }, [text]);

  if (!text) return null;

  return (
    <div className="scifi-speech-bubble-wrapper">
      <button onClick={onClose} className="scifi-speech-bubble-close">✕</button>
      <div className="scifi-speech-bubble-text">{displayedText}</div>
      <div className="scifi-speech-bubble-tail"></div>
    </div>
  );
};

const AIbar = ({ activeFormId, activeFormName }: Props) => {
  const lang = useLanguageStore((state) => state.language);
  const session = useSession();

  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [sessionId, setSessionId] = useState<string>("");
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  React.useEffect(() => {
    let sid = sessionStorage.getItem("agent_session_id");
    if (!sid) {
      sid = "sess_" + crypto.randomUUID();
      sessionStorage.setItem("agent_session_id", sid);
    }
    setSessionId(sid);
  }, []);

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
  const sidebarOpen = useAgentStore((state) => state.isSidebarOpen);
  const setSidebarOpen = useAgentStore((state) => state.setSidebarOpen);

  const [confirmationModalOpen, setConfirmationModalOpen] = useState(false);
  const [stage3Action, setStage3Action] = useState<AgentAction | null>(null);
  const [bubbleMessage, setBubbleMessage] = useState("");

  // Read-only Table modal state
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [tableData, setTableData] = useState<any>(null);

  const handleAIChat = async (userPrompt: string, mergeApproved: boolean = false, ticketId?: string) => {
    if (!userPrompt.trim() && !mergeApproved) return;
    setIsLoading(true);
    setBubbleMessage("");
    setSidebarOpen(true);

    if (!mergeApproved && userPrompt.trim()) {
      setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: "user", content: userPrompt.trim() }]);
    }

    try {
      const url = new URL("/api/agent/execute", window.location.origin);
      if (userPrompt) url.searchParams.set("prompt", userPrompt);
      if (mergeApproved) url.searchParams.set("mergeApproved", "true");
      if (ticketId) url.searchParams.set("resumeTicketId", ticketId);
      if (sessionId) url.searchParams.set("sessionId", sessionId);

      const eventSource = new EventSource(url.toString());

      eventSource.onmessage = (event) => {
        if (event.data === "[DONE]") {
          eventSource.close();
          setIsLoading(false);
          // Proceed to handle final state logic below
          handleFinalState();
        } else {
          try {
            const stateData = JSON.parse(event.data);
            if (stateData.error) {
              if (!useAgentStore.getState().isSidebarOpen) {
                toast.error(stateData.error);
              }
              if (stateData.type === "error") {
                eventSource.close();
                setIsLoading(false);
              }
            } else {
              setAgentState(stateData);
              // Store latest state in a ref or local var to process when [DONE] is received
              finalStateRef.current = stateData; 
            }
          } catch (e) {}
        }
      };

      eventSource.onerror = (error) => {
        console.error("EventSource failed:", error);
        eventSource.close();
        setIsLoading(false);
      };

      // We need a helper to run the finalState logic since EventSource is event-driven
      const finalStateRef = { current: null as AgentState | null };
      
      const handleFinalState = () => {
        const finalState = finalStateRef.current;
        if (!finalState) return;

        const ticketStage = finalState.ticket?.stage || "STAGE_1";

        // Always open the sidebar (ChatGPT-style interface)
        if (ticketStage !== "STAGE_3") {
          setSidebarOpen(true);
        }

        const msg = finalState.reply || finalState.drafterMessage || "";
        if (msg) {
          setChatMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.role === "assistant" && lastMsg.content === msg) {
              return prev; // prevent duplicate messages
            }
            return [...prev, { id: crypto.randomUUID(), role: "assistant", content: msg }];
          });
          talkBack(msg);
        }

        if (ticketStage === "STAGE_3") {
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

        // Check if query_responses or run_database_query tool was executed to open table modal
        const queryAction = finalState.actionPlan?.find(
          (a) => (a.tool === "query_responses" || a.tool === "run_database_query") && a.status === "done"
        );
        if (queryAction && queryAction.result) {
          // agentTools returns { results: [...] } for run_database_query
          const dataToRender = Array.isArray(queryAction.result)
            ? queryAction.result
            : queryAction.result.results
            ? queryAction.result.results
            : [queryAction.result];
            
          setTableData(dataToRender);
          setTableModalOpen(true);
        }
      };

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
    if (!useAgentStore.getState().isSidebarOpen) {
      setBubbleMessage(message);
    }
  };

  const latestAssistantMessage = agentState?.reply || agentState?.evaluatorFeedback;

  return (
    <div className="w-full flex flex-col items-center gap-2">
      {/* Robotic Input Bar */}
      <div className="ai-bar flex items-center gap-3 w-full bg-slate-900/90 border border-cyan-500/30 p-3 rounded-2xl shadow-xl backdrop-blur-md relative z-10">
        <div className="ai-input-section flex-1">
          <input
            disabled={isLoading || !isOnline}
            onKeyDown={(e) => {
              if (e.key === "Enter" && prompt.trim() !== "" && isOnline) {
                setPromptHistory((prev) => [...prev, prompt]);
                setHistoryIndex(-1);
                handleAIChat(prompt, false, agentState?.ticket?.ticketId);
                setPrompt("");
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (promptHistory.length > 0) {
                  const nextIndex = historyIndex === -1 ? promptHistory.length - 1 : Math.max(0, historyIndex - 1);
                  setHistoryIndex(nextIndex);
                  setPrompt(promptHistory[nextIndex]);
                }
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                if (promptHistory.length > 0 && historyIndex !== -1) {
                  const nextIndex = historyIndex + 1;
                  if (nextIndex >= promptHistory.length) {
                    setHistoryIndex(-1);
                    setPrompt("");
                  } else {
                    setHistoryIndex(nextIndex);
                    setPrompt(promptHistory[nextIndex]);
                  }
                }
              }
            }}
            placeholder={isOnline ? "Type prompt (e.g. 'how many responses?', 'build a form', 'delete form')..." : "AI Engine is offline. Start Ollama."}
            className="ai-input w-full bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:border-cyan-500 transition-all"
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="relative flex items-center justify-center">
          <TypewriterSpeechBubble key={bubbleMessage} text={bubbleMessage} onClose={() => setBubbleMessage("")} />
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
                  setPromptHistory((prev) => [...prev, prompt]);
                  setHistoryIndex(-1);
                  handleAIChat(prompt, false, agentState?.ticket?.ticketId);
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
      </div>

      {/* STAGE 2: Slide-Over Sidebar Chat Drawer */}
      <AgentSidebarDrawer
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        agentState={agentState}
        chatMessages={chatMessages}
        onMerge={() => handleAIChat("", true, agentState?.ticket?.ticketId)}
        onSendPrompt={(p) => handleAIChat(p, false, agentState?.ticket?.ticketId)}
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
