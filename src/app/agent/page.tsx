"use client";
import React, { useState, useCallback } from "react";
import { AgentVisualizer } from "@/components/AgentVisualizer/AgentVisualizer";
import { AgentState } from "@/agent/types";
import toast from "react-hot-toast";
import { useAgentWS } from "@/hooks/useAgentWS";

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(";").shift() || null;
  return null;
}

export default function AgentTestingPage() {
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState<{ persona: string; content: string } | null>(null);
  const [healthStatus, setHealthStatus] = useState<string>("unknown");

  const token = getCookie("token") || "";

  const handleStateUpdate = useCallback((state: AgentState) => {
    setAgentState(state);
    setIsLoading(false);
  }, []);

  const handleToken = useCallback((persona: string, chunk: string) => {
    setStreamingContent((prev) => {
      if (prev !== null && prev.persona === persona) {
        return { persona, content: prev.content + chunk };
      }
      return { persona, content: chunk };
    });
  }, []);

  const handleBusy = useCallback((message: string) => {
    setIsLoading(true);
    toast.loading(message, { id: "agent-busy" });
  }, []);

  const handleError = useCallback((message: string) => {
    setIsLoading(false);
    setStreamingContent(null);
    toast.error(message);
  }, []);

  const handleHealth = useCallback((status: string) => {
    setHealthStatus(status);
  }, []);

  const handleConnected = useCallback(() => {
    console.log("[AgentPage] WS connected");
    toast.success("Connected to agent", { duration: 2000, id: "ws-connected" });
  }, []);

  const handleDisconnected = useCallback(() => {
    toast.error("Disconnected from agent. Reconnecting...", { duration: 5000, id: "ws-disconnected" });
  }, []);

  const handleReconnect = useCallback((attempt: number) => {
    toast.loading(`Reconnecting... (attempt ${attempt})`, { duration: 10000, id: "ws-reconnect" });
  }, []);

  const { sendPrompt, sendMerge, sendResume, isConnected, connectionError } = useAgentWS({
    token,
    onState: handleStateUpdate,
    onToken: handleToken,
    onBusy: handleBusy,
    onError: handleError,
    onHealth: handleHealth,
    onConnected: handleConnected,
    onDisconnected: handleDisconnected,
    onReconnect: handleReconnect,
  });

  const handleRunPrompt = (prompt: string) => {
    setIsLoading(true);
    setStreamingContent(null);
    sendPrompt(prompt);
  };

  const handleMerge = () => {
    if (agentState?.ticket?.ticketId) {
      sendMerge(agentState.ticket.ticketId);
    }
  };

  const handleResume = (ticketId: string) => {
    sendResume(ticketId);
  };

  return (
    <div className="agent-wrapper">
      <div className="mb-4 flex items-center gap-4">
        <div className={`w-3 h-3 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
        <span className="text-sm text-gray-600">
          {isConnected ? "Connected" : "Disconnected"}
          {connectionError && ` - ${connectionError}`}
        </span>
        <span className="text-xs text-gray-400 ml-4">LLM: {healthStatus}</span>
      </div>
      <AgentVisualizer
        agentState={agentState}
        isLoading={isLoading}
        streamingContent={streamingContent}
        onSendPrompt={handleRunPrompt}
        onMerge={handleMerge}
        onResume={handleResume}
      />
    </div>
  );
}