"use client";
import React, { useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AgentState, PersonaStage } from "@/agent/types";
import { AgentActionChecklist } from "./AgentActionChecklist";
import { ChatMessage } from "./AIbar";
import { useClickAway } from "@/hooks/useClickAway";
import Icon from "../icons/Icon";

interface AgentSidebarDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  agentState: AgentState | null;
  chatMessages?: ChatMessage[];
  onMerge: () => void;
  onSendPrompt: (prompt: string) => void;
  streamingContent?: { persona: string; content: string } | null;
}

export const AgentSidebarDrawer: React.FC<AgentSidebarDrawerProps> = ({
  isOpen,
  onClose,
  agentState,
  chatMessages = [],
  onMerge,
  onSendPrompt,
  streamingContent,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [showProcess, setShowProcess] = useState(false);

  // D-S3.7 — surface new tool kinds (prefs / notifications / exports / views)
  // in the trace visualization when the step payload carries toolKind.
  const renderToolKind = (trace: any) => {
    const kind = trace?.payload?.toolKind ?? trace?.toolKind;
    if (!kind) return null;
    return <span className="agent-thought-toolkind">{kind}</span>;
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, agentState?.actionPlan, agentState?.executionTrace]);

  if (!isOpen || !mounted) return null;

  const target = document.querySelector(".app-cnt");
  if (!target) return null;

  return createPortal(
    <div ref={drawerRef} className="agent-chat-overlay">

      <div className="agent-chat-header">

        <button
          onClick={onClose}
          className="agent-chat-close-btn"
          title="Close Agent Chat"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="agent-chat-container scifi-drawer-body">

        {chatMessages.length === 0 && (!agentState?.executionTrace || agentState.executionTrace.length === 0) && (
          <div className="agent-chat-empty">Listening...</div>
        )}

        {/* Existing Chat Messages (ChatGPT Style) */}
        {chatMessages.map((msg, i) => {
          const renderTextWithLinks = (text: string) => {
            const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
            const parts = [];
            let lastIndex = 0;
            let match;
            while ((match = linkRegex.exec(text)) !== null) {
              if (match.index > lastIndex) {
                parts.push(text.substring(lastIndex, match.index));
              }
              parts.push(
                <a key={match.index} href={match[2]} download className="agent-chat-link">
                  {match[1]}
                </a>
              );
              lastIndex = match.index + match[0].length;
            }
            if (lastIndex < text.length) {
              parts.push(text.substring(lastIndex));
            }
            return parts.length > 0 ? parts : text;
          };

          return (
            <div key={msg.id || i} className="agent-chat-row-wrapper">
              {/* Process Block for finalized past messages */}
              {msg.role === 'assistant' && msg.executionTrace && msg.executionTrace.length > 0 && (
                <div className="agent-thought-stream">
                  <div className="agent-thinking-header">
                    <div className="agent-thinking-header-left">
                      <svg className="agent-thinking-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Process
                    </div>
                    <Icon icon={showProcess ? "chevron-up" : "chevron-down"} action={() => {
                      setShowProcess(!showProcess)
                    }} />
                  </div>
                  {showProcess &&
                    <div className={`agent-thinking-content custom-scrollbar`}>
                      {msg.executionTrace.map((trace: any, j: number) => (
                        <div key={trace.stepId || j} className="agent-thought-step">
                          <div className="agent-thought-message">
                            <strong>[{trace.persona}]</strong> {trace.message}
                            {renderToolKind(trace)}
                          </div>
                          {trace.payload?.thoughtProcess && (
                            <div className="agent-thought-process">
                              {trace.payload.thoughtProcess}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  }

                </div>
              )
              }

              <div className={`agent-chat-row ${msg.role === 'user' ? 'agent-chat-row-user' : 'agent-chat-row-assistant'}`}>
                {msg.role === 'assistant' && (
                  <div className="agent-chat-avatar-gpt">
                    <div className="scifi-circle-placeholder" />
                  </div>
                )}
                <div className={`agent-chat-bubble ${msg.role === 'user' ? 'agent-chat-user' : 'agent-chat-assistant'}`}>
                  <div className="agent-chat-content whitespace-pre-wrap">
                    {renderTextWithLinks(msg.content)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Live Thought Stream for the active agent call */}
        {(streamingContent || (agentState?.executionTrace && !agentState?.isComplete)) && (
          <div className="agent-thought-stream">
            <details className="agent-thinking-dropdown" open={!!streamingContent}>
              <summary className="agent-thinking-summary">
                <div className="agent-thinking-header">
                  <svg className="agent-thinking-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  {streamingContent ? "Processing..." : "Process"}
                </div>
                <span className="process-caret"></span>
              </summary>
              <div className="agent-thinking-content custom-scrollbar">
                {agentState?.executionTrace?.map((trace, i) => (
                  <div key={trace.stepId || i} className="agent-thought-step">
                    <div className="agent-thought-message">
                      <strong>[{trace.persona}]</strong> {trace.message}
                      {renderToolKind(trace)}
                    </div>
                    {trace.payload?.thoughtProcess && (
                      <div className="agent-thought-process">
                        {trace.payload.thoughtProcess}
                      </div>
                    )}
                  </div>
                ))}

                {/* Live streaming chunk */}
                {streamingContent && (
                  <div className="agent-thought-step">
                    <div className="agent-thought-message">
                      <strong>[{streamingContent.persona}]</strong> Generating thoughts...
                    </div>
                    <div className="agent-thought-process">
                      {streamingContent.content}<span className="scifi-blink">_</span>
                    </div>
                  </div>
                )}
              </div>
            </details>
          </div>
        )}

        {/* Action Checklist Removed for clean DeepSeek UI */}

        {/* Final Production DB Merge Control */}
        {agentState?.isComplete && agentState.activePersona === "AWAITING_USER_APPROVAL" && (
          <div className="scifi-approval-box">
            <div className="scifi-approval-title">
              <span>🎉</span> Sandbox Evaluation Passed!
            </div>
            <p className="scifi-approval-text">
              The Evaluator verified that all draft actions match your requirements. Would you like to merge the Sandbox draft to the production database?
            </p>
            <button onClick={() => { onMerge(); }} className="scifi-approval-btn">
              Approve & Merge to Database 🚀
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div >,
    target
  );
};
