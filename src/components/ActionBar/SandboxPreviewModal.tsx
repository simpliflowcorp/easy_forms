"use client";
import React from "react";
import DynamicFieldManger from "@/components/Inputs/DynamicFieldManger";
import * as agentTools from "@/lib/agentTools";

/**
 * D-S2.8 — Sandbox preview modal (READ-ONLY).
 *
 * Mounts the existing FormRenderer (the public-form `DynamicFieldManger`
 * layout) against a sandboxed Redis draft. The draft is fetched through
 * Agent B's read path `getSandboxPreview(ticketId)` from `src/lib/agentTools.ts`
 * (frozen contract: `{ elements, name, description }` — never a write path).
 *
 * Safety: opening / closing NEVER merges, never writes production, and never
 * touches the sandbox TTL — this component performs GET reads only.
 */

/** Frozen contract mirror of Agent B's `getSandboxPreview` return shape. */
export interface SandboxFormElement {
  label: string;
  type: number;
  options?: { label: string; value: string }[];
  required?: boolean;
  column?: number;
  [k: string]: unknown;
}

export interface SandboxFormDraft {
  name: string;
  description?: string;
  elements: SandboxFormElement[];
  [k: string]: unknown;
}

interface SandboxPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticketId?: string;
  /** Optional pre-fetched draft (callers may wire B's read path directly). */
  draft?: SandboxFormDraft | null;
  /** Optional custom fetcher; defaults to B's read path / preview route. */
  fetchPreview?: (ticketId: string) => Promise<SandboxFormDraft>;
}

/**
 * Default read path: Agent B's `getSandboxPreview` when present (integration),
 * falling back to the sandbox preview API route. GET-only.
 */
async function defaultFetchPreview(ticketId: string): Promise<SandboxFormDraft> {
  try {
    // Agent B's `getSandboxPreview` read path (lands at the integration gate).
    const readFn = (agentTools as any).getSandboxPreview as
      | ((ticketId: string) => Promise<SandboxFormDraft>)
      | undefined;
    if (typeof readFn === "function") {
      const draft = await readFn(ticketId);
      if (draft && Array.isArray(draft.elements)) {
        return draft as SandboxFormDraft;
      }
      throw new Error("getSandboxPreview returned no elements");
    }
  } catch {
    // read path not shipped yet — fall through to the API route
  }

  const res = await fetch(`/api/agent/sandbox/preview?ticketId=${encodeURIComponent(ticketId)}`, {
    method: "GET",
  });
  if (!res.ok) {
    throw new Error(`Sandbox preview fetch failed: ${res.status}`);
  }
  const body = await res.json();
  if (!body || !Array.isArray(body.elements)) {
    throw new Error("Sandbox preview returned an invalid draft shape");
  }
  return body as SandboxFormDraft;
}

export const SandboxPreviewModal: React.FC<SandboxPreviewModalProps> = ({
  isOpen,
  onClose,
  ticketId,
  draft: draftProp,
  fetchPreview,
}) => {
  const [draft, setDraft] = React.useState<SandboxFormDraft | null>(draftProp ?? null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    if (draftProp) {
      setDraft(draftProp);
      setError(null);
      return;
    }
    if (!ticketId) {
      setError("No ticket id available for sandbox preview.");
      return;
    }
    setLoading(true);
    setError(null);
    const fetcher = fetchPreview ?? defaultFetchPreview;
    fetcher(ticketId)
      .then((d) => setDraft(d))
      .catch((err: any) => setError(err?.message ?? String(err)))
      .finally(() => setLoading(false));
  }, [isOpen, ticketId, draftProp, fetchPreview]);

  if (!isOpen) return null;

  const elements = draft?.elements ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-slate-900 border border-cyan-500/30 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-cyan-950/60 border border-cyan-500/40 flex items-center justify-center text-base flex-shrink-0">
              👁️
            </div>
            <div>
              <h3 className="text-base font-bold">Sandbox Preview (read-only)</h3>
              <p className="text-[11px] text-cyan-400 font-mono">
                Draft: {draft?.name ?? "…"} — nothing merges from this view
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 bg-slate-800/70 hover:bg-slate-700 rounded-lg transition-colors"
            aria-label="Close sandbox preview"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-4 space-y-3">
          {loading && <div className="accent-line-loader"></div>}

          {error && (
            <div className="bg-red-950/50 border border-red-500/40 rounded-lg p-3 text-xs text-red-300">
              {error}
            </div>
          )}

          {!loading && !error && elements.length === 0 && (
            <div className="text-center text-xs text-slate-400 py-8">
              This draft has no elements yet.
            </div>
          )}

          {!loading && !error && elements.length > 0 && (
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
              {draft?.description && (
                <p className="text-[11px] text-slate-400 italic">{draft.description}</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                {elements.map((element, index) => (
                  <div
                    key={index}
                    className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 pointer-events-none"
                  >
                    <DynamicFieldManger
                      reset={0}
                      label={element.label}
                      options={element.options ? element.options : []}
                      value={""}
                      updateValue={() => undefined}
                      isRequired={element.required === true}
                      isValid={true}
                      updateIsValid={() => undefined}
                      type={element.type}
                    />
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500">
                {elements.length} field{elements.length === 1 ? "" : "s"} · preview only ·
                strictly read-only
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 pb-5 pt-3 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Close (no merge)
          </button>
        </div>
      </div>
    </div>
  );
};

export default SandboxPreviewModal;
