/**
 * Frozen contracts for the sandbox merge engine (D0.4). Exported from
 * `src/agent/sandbox/types.ts` so the loop's reply renderer (Agent A) and
 * the merge engine (this module) code against one shape.
 *
 * The six counters are raw and mutually exclusive: a merged draft counts
 * only in `mergedForms`/`mergedViews`; an applied update only in
 * `updatesApplied`; an applied delete only in `deletesApplied`. They are
 * intentionally NOT summed into a single "merged changes" number — the old
 * inflated `mergedForms` (which included updates + deletes) mislabeled
 * deletes as creations.
 */

export interface MergeStats {
  mergedForms: number;
  mergedViews: number;
  updatesApplied: number;
  updatesMissed: number;
  deletesApplied: number;
  deletesMissed: number;
}