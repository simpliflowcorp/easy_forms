"use client";
import React, { useState } from "react";
import { AgentVisualizer } from "@/components/AgentVisualizer/AgentVisualizer";
import { AgentState } from "@/agent/types";
import toast from "react-hot-toast";

export default function AgentTestingPage() {
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleRunPrompt = async (prompt: string, mergeApproved: boolean = false, resumeTicketId?: string) => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          mergeApproved,
          resumeTicketId,
        }),
      });

      const stateData: AgentState = await res.json();
      setIsLoading(false);
      setAgentState(stateData);

      if (stateData.reply) {
        toast.success(stateData.reply, { duration: 4000 });
      }
    } catch (err: any) {
      setIsLoading(false);
      toast.error("Execution error");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 py-8 px-4">
      <AgentVisualizer
        agentState={agentState}
        isLoading={isLoading}
        onSendPrompt={(p) => handleRunPrompt(p)}
        onMerge={() => handleRunPrompt("", true)}
        onResume={(ticketId) => handleRunPrompt(agentState?.prompt || "", false, ticketId)}
      />
    </div>
  );
}
