"use client";
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface SkillRow {
  _id: string;
  name: string;
  version: string;
  source: "user" | "builtin";
  tools?: Array<{ tool?: string }>;
  deprecatedAt?: string | null;
}

interface AgentSkillsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Agent Skills Drawer (D-S3.7) — manage user-authored + built-in skills.
 * Wired to /api/agent/skills CRUD routes (list / register / edit / delete).
 */
export const AgentSkillsDrawer: React.FC<AgentSkillsDrawerProps> = ({ isOpen, onClose }) => {
  const [mounted, setMounted] = useState(false);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SkillRow | null>(null);
  const [editTools, setEditTools] = useState("");
  const [editName, setEditName] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadSkills = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/skills");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSkills(data.skills ?? []);
    } catch (e: any) {
      setError(e.message || "Failed to load skills");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) loadSkills();
  }, [isOpen]);

  if (!isOpen || !mounted) return null;
  const target = document.querySelector(".app-cnt");
  if (!target) return null;

  const startEdit = (row: SkillRow) => {
    setEditing(row);
    setEditName(row.name);
    setEditTools((row.tools ?? []).map((t) => t.tool ?? "").join(", "));
    setTestResult(null);
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      const res = await fetch(`/api/agent/skills/${encodeURIComponent(editing._id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patch: {
            name: editName.trim(),
            tools: editTools
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
              .map((tool) => ({ tool, paramsFrom: "requirements" })),
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const updated = data.skill;
      setSkills((prev) => prev.map((s) => (s._id === updated._id ? updated : s)));
      setEditing(null);
      setTestResult(`Saved — version bumped to ${updated.version}`);
    } catch (e: any) {
      setTestResult(`Save failed: ${e.message}`);
    }
  };

  const testSkill = (row: SkillRow) => {
    const toolNames = (row.tools ?? []).map((t) => t.tool ?? "").filter(Boolean);
    const assertions = [
      `tools: ${toolNames.length ? toolNames.join(", ") : "none declared"}`,
      `maxIterations: ${(row as any).definition?.maxIterations ?? "n/a"}`,
      `negativeTests: ${(row as any).definition?.negativeTests?.length ?? 0}`,
    ];
    setTestResult(`[${row.name} v${row.version}] ${assertions.join(" | ")}`);
  };

  const removeSkill = async (row: SkillRow) => {
    if (!window.confirm(`Delete skill "${row.name}"?`)) return;
    try {
      const res = await fetch(`/api/agent/skills/${encodeURIComponent(row._id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setSkills((prev) => prev.filter((s) => s._id !== row._id));
      setTestResult(`"${row.name}" deleted`);
    } catch (e: any) {
      setTestResult(`Delete failed: ${e.message}`);
    }
  };

  return createPortal(
    <div className="agent-skills-overlay" onClick={onClose}>
      <div className="agent-skills-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="agent-skills-header">
          <span>Skills Registry</span>
          <button onClick={onClose} className="agent-chat-close-btn" title="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="agent-skills-body custom-scrollbar">
          {loading && <div className="agent-chat-empty">Loading skills...</div>}
          {error && <div className="agent-skills-error">{error}</div>}

          {!loading &&
            skills.map((row) => (
              <div key={row._id} className={`agent-skill-row ${row.deprecatedAt ? "agent-skill-deprecated" : ""}`}>
                <div className="agent-skill-info">
                  <div className="agent-skill-name">
                    {row.name}
                    <span className="agent-skill-version">v{row.version}</span>
                    {row.source === "builtin" ? (
                      <span className="agent-skill-badge agent-skill-badge-builtin">BUILTIN</span>
                    ) : (
                      <span className="agent-skill-badge agent-skill-badge-user">USER</span>
                    )}
                    {row.deprecatedAt && <span className="agent-skill-badge">DEPRECATED</span>}
                  </div>
                  <div className="agent-skill-tools">
                    {(row.tools ?? []).map((t, i) => t.tool && <code key={i}>{t.tool}</code>)}
                  </div>
                </div>
                <div className="agent-skill-actions">
                  <button onClick={() => testSkill(row)} className="agent-skill-btn">
                    Test
                  </button>
                  {row.source === "user" && (
                    <>
                      <button onClick={() => startEdit(row)} className="agent-skill-btn">
                        Edit
                      </button>
                      <button onClick={() => removeSkill(row)} className="agent-skill-btn agent-skill-btn-danger">
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}

          {!loading && skills.length === 0 && !error && (
            <div className="agent-chat-empty">No skills yet — ask the Skill Author to "remember" a template.</div>
          )}

          {testResult && <div className="agent-skills-test-result">{testResult}</div>}

          {editing && (
            <div className="agent-skills-edit">
              <div className="agent-skills-edit-title">Edit {editing.name}</div>
              <label className="agent-skills-label">
                Name
                <input
                  className="agent-skills-input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </label>
              <label className="agent-skills-label">
                Tools (comma-separated)
                <input
                  className="agent-skills-input"
                  value={editTools}
                  onChange={(e) => setEditTools(e.target.value)}
                />
              </label>
              <div className="agent-skills-edit-actions">
                <button onClick={saveEdit} className="agent-skill-btn">
                  Save (bump version)
                </button>
                <button onClick={() => setEditing(null)} className="agent-skill-btn">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    target,
  );
};

export default AgentSkillsDrawer;