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

/**
 * B-S2.8: MergeableKind — classifies each sandbox intention so the merge engine
 * routes to the correct collection and apply function.
 */
export type MergeableKind =
  | "form_create"
  | "form_update"
  | "form_delete"
  | "view_create"
  | "view_update"
  | "view_delete"
  | "user_update"
  | "form_status"
  | "form_metadata"
  | "skill_create"
  | "skill_update"
  | "skill_soft_delete"
  | "form_version_snapshot"
  | "resource_lock_acquire"
  | "resource_lock_release";

/**
 * B-S3.4: MergeRequest — passed from the orchestrator when user confirms merge.
 * mergeApprovedActionIds restricts which actions to merge (empty = all).
 * Stage-2 gap filled here (was absent at draft time).
 */
export interface MergeRequest {
  ticketId: string;
  userId: string;
  mergeApprovedActionIds: string[];
}

/**
 * B-S2.9: USER_SAFE_FIELDS — allowlist for user profile/preference mutations.
 * Any field NOT in this set is REVOKED at merge time with UserUnsafeFieldError.
 */
export const USER_SAFE_FIELDS = new Set<string>([
  // Profile fields
  "profile.firstName",
  "profile.lastName",
  "profile.dob",
  "profile.phoneNumber",
  "profile.address",
  "profile.city",
  "profile.state",
  "profile.country",
  "profile.zipCode",
  "profile.about",
  "profile.website",
  "profile.profileImage",
  // Preferences
  "preferences.dateFormat",
  "preferences.language",
  "preferences.country",
  "preferences.timeFormat",
  // Notification settings
  "notificationSettings.popup.formExpired",
  "notificationSettings.popup.newResponseAlert",
  "notificationSettings.email.formExpired",
  "notificationSettings.email.newResponseAlert",
  "notificationSettings.email.responseSummary",
  // Top-level object replacement keys (used in executor's updatesParam)
  "profile",
  "preferences",
  "notificationSettings",
]);

/** Error thrown when a user update contains a revoked (unsafe) field. */
export class UserUnsafeFieldError extends Error {
  public readonly unsafeFields: string[];
  constructor(fields: string[]) {
    super(`User update contains unsafe fields: ${fields.join(", ")}`);
    this.name = "UserUnsafeFieldError";
    this.unsafeFields = fields;
  }
}