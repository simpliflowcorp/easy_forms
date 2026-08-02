"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { AgentState } from "@/agent/types";

interface WSMessage {
  type: "connected" | "state" | "token" | "busy" | "error" | "done" | "health" | "pong" | "replay" | "prompt" | "merge" | "resume" | "ping";
  payload: any;
}

interface UseAgentWSOptions {
  token: string;
  onState?: (state: AgentState) => void;
  onToken?: (persona: string, token: string) => void;
  onBusy?: (message: string) => void;
  onError?: (message: string) => void;
  onHealth?: (status: string) => void;
  onConnected?: () => void;
  onReconnect?: (attempt: number) => void;
  onDisconnected?: () => void;
}

interface QueuedMessage {
  message: WSMessage;
  timestamp: number;
}

export function useAgentWS({
  token,
  onState,
  onToken,
  onBusy,
  onError,
  onHealth,
  onConnected,
  onReconnect,
  onDisconnected,
}: UseAgentWSOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const maxReconnectAttempts = 10;
  const baseReconnectDelay = 1000; // 1s
  const maxReconnectDelay = 30000; // 30s
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messageQueueRef = useRef<QueuedMessage[]>([]);
  const lastStateRef = useRef<AgentState | null>(null);
  const lastTicketIdRef = useRef<string | null>(null);
  const isConnectingRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Persist last known state to localStorage for recovery
  const saveStateToStorage = useCallback((state: AgentState) => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("agent_last_state", JSON.stringify({
          state,
          timestamp: Date.now(),
        }));
      } catch (e) {
        // Ignore storage errors
      }
    }
  }, []);

  const loadStateFromStorage = useCallback((): AgentState | null => {
    if (typeof window === "undefined") return null;
    try {
      const stored = localStorage.getItem("agent_last_state");
      if (stored) {
        const { state, timestamp } = JSON.parse(stored);
        // Only use if less than 1 hour old
        if (Date.now() - timestamp < 3600000) {
          return state;
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
    return null;
  }, []);

  const clearStorage = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("agent_last_state");
    }
  }, []);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const calculateReconnectDelay = useCallback((attempt: number): number => {
    const delay = Math.min(
      baseReconnectDelay * Math.pow(2, attempt) + Math.random() * 1000,
      maxReconnectDelay
    );
    return delay;
  }, []);

  const flushMessageQueue = useCallback((ws: WebSocket) => {
    while (messageQueueRef.current.length > 0) {
      const queued = messageQueueRef.current.shift();
      if (queued && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(queued.message));
      }
    }
  }, []);

  const sendMessage = useCallback((message: WSMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    } else {
      // Queue for later
      messageQueueRef.current.push({ message, timestamp: Date.now() });
    }
  }, []);

  const connect = useCallback(() => {
    if (!token || isConnectingRef.current) return;
    
    isConnectingRef.current = true;
    clearReconnectTimeout();

    // Determine WebSocket URL
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/ws?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[useAgentWS] Connected");
      isConnectingRef.current = false;
      reconnectAttemptRef.current = 0;
      setIsConnected(true);
      setConnectionError(null);
      onConnected?.();

      // Flush queued messages
      flushMessageQueue(wsRef.current!);

      // Request state replay if we have a previous ticket
      if (lastTicketIdRef.current) {
        sendMessage({
          type: "replay",
          payload: { ticketId: lastTicketIdRef.current },
        });
      }
    };

    ws.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);
        handleMessage(message);
      } catch (err) {
        console.error("[useAgentWS] Message parse error:", err);
      }
    };

    ws.onclose = (event) => {
      console.log(`[useAgentWS] Disconnected: ${event.code} ${event.reason}`);
      isConnectingRef.current = false;
      setIsConnected(false);
      onDisconnected?.();

      // Schedule reconnect if not a clean closure
      if (event.code !== 1000 && reconnectAttemptRef.current < maxReconnectAttempts) {
        const delay = calculateReconnectDelay(reconnectAttemptRef.current);
        console.log(`[useAgentWS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current + 1})`);
        onReconnect?.(reconnectAttemptRef.current + 1);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptRef.current++;
          connect();
        }, delay);
      } else if (reconnectAttemptRef.current >= maxReconnectAttempts) {
        setConnectionError("Max reconnection attempts reached. Please refresh the page.");
      }
    };

    ws.onerror = (error) => {
      console.error("[useAgentWS] Error:", error);
      setConnectionError("Connection error");
    };
  }, [token, onConnected, onDisconnected, onReconnect]);

  const handleMessage = useCallback((message: WSMessage) => {
    switch (message.type) {
      case "connected": {
        console.log("[useAgentWS] Server confirmed connection");
        break;
      }
      case "state": {
        const state = message.payload as AgentState;
        lastStateRef.current = state;
        if (state.ticket?.ticketId) {
          lastTicketIdRef.current = state.ticket.ticketId;
        }
        saveStateToStorage(state);
        onState?.(state);
        break;
      }
      case "token": {
        const { persona, token } = message.payload;
        onToken?.(persona, token);
        break;
      }
      case "busy": {
        onBusy?.(message.payload?.message);
        break;
      }
      case "error": {
        onError?.(message.payload?.message);
        break;
      }
      case "done": {
        // Final state received, could clear storage
        break;
      }
      case "health": {
        onHealth?.(message.payload?.status);
        break;
      }
      case "pong": {
        // Heartbeat response
        break;
      }
      case "replay": {
        // Server sent replayed messages
        if (message.payload?.messages) {
          for (const replayedMsg of message.payload.messages) {
            handleMessage(replayedMsg);
          }
        }
        break;
      }
      default:
        console.warn("[useAgentWS] Unknown message type:", message.type);
    }
  }, [onState, onToken, onBusy, onError, onHealth]);

  // Initialize connection
  useEffect(() => {
    if (!token) return;

    // Try to restore last state from storage
    const storedState = loadStateFromStorage();
    if (storedState) {
      lastStateRef.current = storedState;
      if (storedState.ticket?.ticketId) {
        lastTicketIdRef.current = storedState.ticket.ticketId;
        onState?.(storedState);
      }
    }

    connect();

    return () => {
      clearReconnectTimeout();
      const ws = wsRef.current;
      if (ws) {
        ws.close(1000, "Component unmounted");
      }
    };
  }, [token, connect]);

  // Expose send function for sending prompts/merges
  const sendPrompt = useCallback((prompt: string, mergeApproved = false, resumeTicketId?: string, sessionId?: string) => {
    sendMessage({
      type: "prompt",
      payload: { prompt, mergeApproved, resumeTicketId, sessionId },
    });
  }, []);

  const sendMerge = useCallback((ticketId: string) => {
    sendMessage({
      type: "merge",
      payload: { ticketId },
    });
  }, []);

  const sendResume = useCallback((ticketId: string) => {
    sendMessage({
      type: "resume",
      payload: { ticketId },
    });
  }, []);

  const ping = useCallback(() => {
    sendMessage({ type: "ping", payload: {} });
  }, []);

  return {
    isConnected,
    connectionError,
    sendPrompt,
    sendMerge,
    sendResume,
    ping,
    lastState: lastStateRef.current,
    lastTicketId: lastTicketIdRef.current,
  };
}