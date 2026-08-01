"use client";
import React from "react";
import { AgentAction } from "@/lib/agentTools";

interface AgentActionChecklistProps {
  summary: string;
  actions: AgentAction[];
  onRunAction: (action: AgentAction) => void;
  onConfirmAction: (action: AgentAction) => void;
}

export const AgentActionChecklist: React.FC<AgentActionChecklistProps> = ({
  summary,
  actions,
  onRunAction,
  onConfirmAction,
}) => {
  if (!actions || actions.length === 0) return null;

  const completedCount = actions.filter((a) => a.status === "done").length;
  const progressPercent = Math.round((completedCount / actions.length) * 100);

  return (
    <div className="scifi-checklist-wrapper">
      <div className="scifi-checklist-header">
        <div>
          <h4 className="scifi-checklist-title">
            <span className="scifi-checklist-ping" />
            AI Agent Action Checklist
          </h4>
          <p className="scifi-checklist-subtitle">{summary}</p>
        </div>
        <div className="scifi-checklist-stats">
          <span className="scifi-checklist-stats-text">
            {completedCount}/{actions.length} Done ({progressPercent}%)
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="scifi-checklist-progress-bg">
        <div
          className="scifi-checklist-progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="scifi-checklist-items">
        {actions.map((act, idx) => (
          <div
            key={act.id || idx}
            className={`scifi-checklist-item scifi-checklist-status-${act.status}`}
          >
            <div className="scifi-checklist-item-left">
              <span className="scifi-checklist-item-index">
                0{idx + 1}
              </span>
              <div className="scifi-checklist-item-icon">
                {act.status === "done" && (
                  <svg className="scifi-icon-done" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {act.status === "in_progress" && (
                  <svg className="scifi-icon-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                {act.status === "awaiting_confirmation" && (
                  <span className="scifi-icon-warn">⚠️</span>
                )}
                {act.status === "error" && (
                  <span className="scifi-icon-error">❌</span>
                )}
                {act.status === "pending" && (
                  <span className="scifi-icon-pending" />
                )}
              </div>

              <div className="scifi-checklist-item-text">
                <span className="scifi-checklist-item-desc">{act.description}</span>
                <span className="scifi-checklist-item-tool">Tool: {act.tool}</span>
              </div>
            </div>

            <div className="scifi-checklist-item-actions">
              {act.status === "pending" && (
                <button
                  onClick={() => onRunAction(act)}
                  className="scifi-checklist-btn-run"
                >
                  Run Step
                </button>
              )}
              {act.status === "awaiting_confirmation" && (
                <button
                  onClick={() => onConfirmAction(act)}
                  className="scifi-checklist-btn-confirm"
                >
                  Approve ⚠️
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
