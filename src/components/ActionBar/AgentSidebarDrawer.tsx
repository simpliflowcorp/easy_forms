"use client";
import React, { useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AgentState, PersonaStage } from "@/agent/types";
import { AgentActionChecklist } from "./AgentActionChecklist";
import { ChatMessage } from "./AIbar";
import { useClickAway } from "@/hooks/useClickAway";

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
    <div ref={drawerRef} className="scifi-chat-overlay">
      <button 
        onClick={onClose}
        className="scifi-chat-close-btn"
        title="Close Agent Chat"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="scifi-chat-container scifi-drawer-body">


        
        {chatMessages.length === 0 && (!agentState?.executionTrace || agentState.executionTrace.length === 0) && (
          <div className="scifi-chat-empty">Listening...</div>
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
                <a key={match.index} href={match[2]} download className="scifi-chat-link">
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
            <div key={msg.id || i} className="scifi-chat-row-wrapper">
              {/* Process Block for finalized past messages */}
              {msg.role === 'assistant' && msg.executionTrace && msg.executionTrace.length > 0 && (
                <div className="scifi-thought-stream">
                  <details className="scifi-thinking-dropdown">
                    <summary className="scifi-thinking-summary">
                      <div className="scifi-thinking-header">
                        <svg className="scifi-thinking-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Process
                      </div>
                      <span className="process-caret"></span>
                    </summary>
                    <div className="scifi-thinking-content custom-scrollbar">
                      {msg.executionTrace.map((trace: any, j: number) => (
                        <div key={trace.stepId || j} className="scifi-thought-step">
                          <div className="scifi-thought-message">
                            <strong>[{trace.persona}]</strong> {trace.message}
                          </div>
                          {trace.payload?.thoughtProcess && (
                            <div className="scifi-thought-process">
                              {trace.payload.thoughtProcess}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}

              <div className={`scifi-chat-row ${msg.role === 'user' ? 'scifi-chat-row-user' : 'scifi-chat-row-assistant'}`}>
                {msg.role === 'assistant' && (
                  <div className="scifi-chat-avatar-gpt">
                    <svg className="w-5 h-5 scifi-agent-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
                <div className={`scifi-chat-bubble ${msg.role === 'user' ? 'scifi-chat-user' : 'scifi-chat-assistant'}`}>
                  <div className="scifi-chat-content whitespace-pre-wrap">
                    {renderTextWithLinks(msg.content)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Live Thought Stream for the active agent call */}
        {(streamingContent || (agentState?.executionTrace && !agentState?.isComplete)) && (
          <div className="scifi-thought-stream">
            <details className="scifi-thinking-dropdown" open={!!streamingContent}>
              <summary className="scifi-thinking-summary">
                <div className="scifi-thinking-header">
                  <svg className="scifi-thinking-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  {streamingContent ? "Processing..." : "Process"}
                </div>
                <span className="process-caret"></span>
              </summary>
              <div className="scifi-thinking-content custom-scrollbar">
                {agentState?.executionTrace?.map((trace, i) => (
                  <div key={trace.stepId || i} className="scifi-thought-step">
                    <div className="scifi-thought-message">
                      <strong>[{trace.persona}]</strong> {trace.message}
                    </div>
                    {trace.payload?.thoughtProcess && (
                      <div className="scifi-thought-process">
                        {trace.payload.thoughtProcess}
                      </div>
                    )}
                  </div>
                ))}
                
                {/* Live streaming chunk */}
                {streamingContent && (
                  <div className="scifi-thought-step">
                    <div className="scifi-thought-message">
                      <strong>[{streamingContent.persona}]</strong> Generating thoughts...
                    </div>
                    <div className="scifi-thought-process">
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
    </div>,
    target
  );
};
