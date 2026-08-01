"use client";
import React, { useState } from "react";
import { AgentVisualizer } from "@/components/AgentVisualizer/AgentVisualizer";
import { AgentState } from "@/agent/types";
import toast from "react-hot-toast";

export default function AgentTestingPage() {
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState<{persona: string, content: string} | null>(null);

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

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalState: AgentState | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (part.startsWith("data: ")) {
            const dataStr = part.slice(6);
            if (dataStr === "[DONE]") {
              break;
            }
            try {
              const stateData = JSON.parse(dataStr);
              if (stateData.type === "stream_chunk") {
                setStreamingContent(prev => {
                  const content = prev?.persona === stateData.persona ? prev.content + stateData.chunk : stateData.chunk;
                  return { persona: stateData.persona, content };
                });
              } else if (stateData.error) {
                toast.error(stateData.error);
                setStreamingContent(null);
              } else {
                setAgentState(stateData);
                finalState = stateData;
                setStreamingContent(null);
              }
            } catch (e) { }
          }
        }
      }

      setIsLoading(false);
      setStreamingContent(null);
      if (finalState?.reply) {
        toast.success(finalState.reply, { duration: 4000 });
      }
    } catch (err: any) {
      setIsLoading(false);
      setStreamingContent(null);
      toast.error("Execution error");
    }
  };

  return (
    <div className="agent-wrapper">
      <AgentVisualizer
        agentState={agentState}
        isLoading={isLoading}
        streamingContent={streamingContent}
        onSendPrompt={(p) => handleRunPrompt(p)}
        onMerge={() => handleRunPrompt("", true, agentState?.ticket?.ticketId)}
        onResume={(ticketId) => handleRunPrompt(agentState?.prompt || "", false, ticketId)}
      />
    </div>
  );
}
