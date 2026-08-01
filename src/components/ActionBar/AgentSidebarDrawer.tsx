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
}

export const AgentSidebarDrawer: React.FC<AgentSidebarDrawerProps> = ({
  isOpen,
  onClose,
  agentState,
  chatMessages = [],
  onMerge,
  onSendPrompt,
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
      <div className="scifi-chat-container scifi-drawer-body">
        <button 
          onClick={onClose}
          className="scifi-chat-close-btn"
          title="Close Agent Chat"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        
        {chatMessages.length === 0 && (!agentState?.executionTrace || agentState.executionTrace.length === 0) && (
          <div className="scifi-chat-empty">Listening...</div>
        )}

        {/* Thought Stream (ChatGPT "Thinking" style) */}
        {agentState?.executionTrace && agentState.executionTrace.length > 0 && (
          <div className="scifi-thought-stream">
            <details className="scifi-thinking-dropdown">
              <summary className="scifi-thinking-summary">
                <svg className="scifi-thinking-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Agent Reasoning Process
              </summary>
              <div className="scifi-thinking-content">
                {agentState.executionTrace.map((trace, i) => (
                  <div key={trace.stepId || i} className="scifi-thought-step">
                    <div className="scifi-thought-message">
                      <strong>{trace.persona}:</strong> {trace.message}
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
            <div key={msg.id || i} className={`scifi-chat-row ${msg.role === 'user' ? 'scifi-chat-row-user' : 'scifi-chat-row-assistant'}`}>
              {msg.role === 'assistant' && (
                <div className="scifi-chat-avatar-gpt">
                  <svg viewBox="0 0 41 41" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5"><path d="M37.5324 16.8707C37.9808 15.5241 38.1363 14.0974 37.9886 12.6859C37.8409 11.2744 37.3934 9.91076 36.676 8.68622C35.6126 6.83404 33.9882 5.3676 32.0373 4.4985C30.0864 3.62941 27.9098 3.40259 25.8215 3.85078C24.8796 2.7893 23.7219 1.94125 22.4257 1.36341C21.1295 0.785575 19.7249 0.491269 18.3058 0.500197C16.1708 0.495044 14.0893 1.16803 12.3614 2.42214C10.6335 3.67624 9.34824 5.4436 8.6917 7.47815C7.30085 7.76286 5.98686 8.3414 4.8377 9.17505C3.68854 10.0087 2.73073 11.0782 2.02839 12.312C0.956464 14.1591 0.498905 16.2988 0.721698 18.4228C0.944492 20.5467 1.83612 22.5449 3.268 24.1293C2.81966 25.4759 2.66413 26.9026 2.81182 28.3141C2.95951 29.7256 3.40701 31.0892 4.12437 32.3138C5.18791 34.1659 6.8123 35.6322 8.76321 36.5013C10.7141 37.3704 12.8907 37.5973 14.9789 37.1492C15.9208 38.2107 17.0786 39.0587 18.3748 39.6366C19.671 40.2144 21.0755 40.5087 22.4946 40.4998C24.6307 40.5054 26.7133 39.8321 28.4423 38.5772C30.1714 37.3223 31.4573 35.5539 32.1143 33.5182C33.5042 33.2327 34.8173 32.6534 35.9655 31.8192C37.1137 30.9849 38.0706 29.9147 38.772 28.6801C39.8458 26.8332 40.3045 24.6934 40.0826 22.5692C39.8606 20.4449 38.9696 18.4463 37.5324 16.8707ZM22.4946 37.8722C20.9266 37.871 19.4132 37.4093 18.1504 36.5502L18.4775 36.3636L29.3514 30.0818C29.6957 29.8848 29.9754 29.6051 30.1724 29.2608C30.3695 28.9165 30.4738 28.5255 30.4738 28.1259V15.535L33.2201 17.1194C33.2721 17.1471 33.317 17.1856 33.3514 17.2319C33.3858 17.2783 33.4087 17.3312 33.4183 17.3867C33.4278 17.4422 33.4237 17.4988 33.4064 17.5521C33.3891 17.6053 33.359 17.6538 33.3186 17.6936L23.7058 23.2396L23.7118 36.434C23.7126 36.8153 23.5615 37.1812 23.2922 37.4507C23.023 37.7202 22.6575 37.8718 22.2762 37.8722H22.4946ZM10.5697 34.0203C9.21334 33.2366 8.21734 31.9669 7.73719 30.443C7.25703 28.9192 7.32431 27.2729 7.92557 25.803L8.25272 25.9896L19.1265 32.2714C19.4709 32.4684 19.8619 32.5727 20.2615 32.5727C20.6611 32.5727 21.0521 32.4684 21.3964 32.2714L32.2743 25.9896V29.1584C32.2731 29.2144 32.2599 29.2694 32.2356 29.3197C32.2114 29.37 32.1765 29.4144 32.1336 29.4501C32.0908 29.4858 32.0409 29.5119 31.9875 29.5267C31.934 29.5414 31.8781 29.5446 31.8236 29.5359L22.2108 35.0819L11.5831 34.6186C11.1895 34.5828 10.8291 34.3752 10.5697 34.0203ZM3.7381 22.8643C3.26521 21.3418 3.32832 19.697 3.91699 18.2289C4.50567 16.7607 5.57861 15.5695 6.93664 14.881L7.26379 15.0676L18.1376 21.3494C18.4819 21.5464 18.7616 21.8262 18.9587 22.1705C19.1557 22.5148 19.26 22.9058 19.26 23.3054V35.8824L16.5137 34.298C16.4613 34.2709 16.416 34.2329 16.3813 34.1869C16.3466 34.1408 16.3235 34.0881 16.3138 34.0325C16.304 33.9768 16.3079 33.92 16.3251 33.8665C16.3423 33.8131 16.3724 33.7645 16.4132 33.7246L26.026 28.1785L26.02 14.9842C26.0195 14.603 25.8679 14.2374 25.5986 13.968C25.3292 13.6987 24.9638 13.5475 24.5826 13.5475H24.3642C25.9322 13.5487 27.4455 14.0104 28.7083 14.8695L28.3812 15.0561L17.5074 21.3379C17.163 21.5349 16.8834 21.8146 16.6863 22.1589C16.4893 22.5032 16.385 22.8942 16.385 23.2938V35.8847L13.6387 37.4691C13.5866 37.4968 13.5418 37.5353 13.5074 37.5816C13.473 37.628 13.4501 37.6809 13.4404 37.7364C13.4309 37.7919 13.435 37.8485 13.4523 37.9018C13.4696 37.9551 13.4997 38.0035 13.5402 38.0433L23.153 32.4973L23.147 19.3029C23.1462 18.9216 23.2972 18.5557 23.5665 18.2862C23.8358 18.0167 24.2012 17.8652 24.5826 17.8647H24.3642ZM30.4354 11.8344C31.7918 12.6181 32.7878 13.8878 33.268 15.4117C33.7481 16.9355 33.6808 18.5818 33.0796 20.0517L32.7524 19.8651L21.8786 13.5833C21.5343 13.3863 21.1432 13.282 20.7437 13.282C20.3441 13.282 19.9531 13.3863 19.6087 13.5833L8.73087 19.8651V16.6963C8.73199 16.6403 8.74526 16.5852 8.76953 16.535C8.79379 16.4847 8.82869 16.4403 8.87158 16.4045C8.91447 16.3688 8.96429 16.3427 9.01775 16.328C9.0712 16.3132 9.12716 16.31 9.1816 16.3187L18.7944 10.7727L29.4221 11.2361C29.8157 11.2719 30.176 11.4795 30.4354 11.8344ZM37.2619 17.1357C37.7348 18.6582 37.6717 20.303 37.083 21.7711C36.4943 23.2393 35.4214 24.4305 34.0634 25.119L33.7362 24.9324L22.8624 18.6506C22.5181 18.4536 22.2384 18.1738 22.0413 17.8295C21.8443 17.4852 21.74 17.0942 21.74 16.6946V4.11762L24.4863 5.70202C24.5387 5.72909 24.584 5.76707 24.6187 5.81309C24.6534 5.85912 24.6765 5.91187 24.6862 5.96752C24.696 6.02318 24.6921 6.08 24.6749 6.13349C24.6577 6.18698 24.6276 6.23551 24.5868 6.27542L14.974 11.8215L14.98 25.0158C14.9805 25.397 15.1321 25.7626 15.4014 26.032C15.6708 26.3013 16.0362 26.4525 16.4174 26.4525H16.6358C15.0678 26.4513 13.5545 25.9896 12.2917 25.1305L12.6188 24.9439L23.4926 18.6621C23.837 18.4651 24.1166 18.1854 24.3137 17.8411C24.5107 17.4968 24.615 17.1058 24.615 16.7062V4.1153L27.3613 2.53093C27.4134 2.50325 27.4582 2.46473 27.4926 2.41842C27.527 2.3721 27.5499 2.31919 27.5596 2.26364C27.5691 2.2081 27.565 2.15152 27.5477 2.0982C27.5304 2.04488 27.5003 1.99649 27.4598 1.95669L17.847 7.5027L17.853 20.6971C17.8538 21.0784 17.7028 21.4443 17.4335 21.7138C17.1642 21.9833 16.7988 22.1348 16.4174 22.1353H16.6358Z" fill="#10a37f"></path></svg>
                </div>
              )}
              <div className={`scifi-chat-bubble ${msg.role === 'user' ? 'scifi-chat-user' : 'scifi-chat-assistant'}`}>
                <div className="scifi-chat-content whitespace-pre-wrap">
                  {renderTextWithLinks(msg.content)}
                </div>
              </div>
            </div>
          );
        })}

        {/* Action Checklist & Strategy */}
        {agentState?.actionPlan && agentState.actionPlan.length > 0 && (
          <AgentActionChecklist
            summary={`Plan Strategy (Sandbox Iteration ${agentState.iterationCount}/${agentState.maxIterations})`}
            actions={agentState.actionPlan}
            onRunAction={() => {}}
            onConfirmAction={() => {}}
          />
        )}

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
