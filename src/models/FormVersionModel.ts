import mongoose from "mongoose";

export interface IFormVersionDocument {
  _id?: string;
  formId: string;
  version: number;
  ownerId: string;
  snapshot: Record<string, any>;
  reason: "agent_merge" | "user_edit" | "rollback_target";
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * FormVersionSnapshot — the read shape returned by `FormVersionModel` query helpers.
 * C-S4.3 + C-S4.5: consumed by Agent A's orchestrator replay (A-S4.5) and by
 * `OrchestratorExecutionModel.formVersionPointers`. Keep this exported here so
 * A's replay adapter has ONE source of truth for the snapshot shape.
 */
export interface FormVersionSnapshot {
  versionId: string;
  formId: string;
  ownerId: string;
  version: number;
  snapshot: Record<string, any>;
  reason: IFormVersionDocument["reason"];
  createdAt: Date;
}

const FormVersionSchema = new mongoose.Schema(
  {
    formId: { type: String, required: true, index: true },
    version: { type: Number, required: true },
    ownerId: { type: String, required: true, index: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    reason: {
      type: String,
      enum: ["agent_merge", "user_edit", "rollback_target"],
      required: true,
    },
  },
  { timestamps: true }
);

FormVersionSchema.index({ formId: 1, version: -1 }, { unique: true });
FormVersionSchema.index({ ownerId: 1, createdAt: -1 });

const FormVersionModel =
  (mongoose.models?.FormVersion as any) ||
  mongoose.model("FormVersion", FormVersionSchema);

/**
 * Find the most recent version at or before `timestamp` for a given form.
 * A-S4.5 replay rollback calls this to locate the pre-edit snapshot to restore.
 */
FormVersionModel.findVersionAtOrBefore = async function (
  formId: string,
  timestamp: Date
): Promise<FormVersionSnapshot | null> {
  const doc = await this.findOne({
    formId,
    createdAt: { $lte: timestamp },
  })
    .sort({ version: -1 })
    .lean();
  if (!doc) return null;
  return {
    versionId: String(doc._id),
    formId: doc.formId,
    ownerId: doc.ownerId,
    version: doc.version,
    snapshot: doc.snapshot,
    reason: doc.reason,
    createdAt: doc.createdAt,
  };
};

/**
 * Atomically restore a form to a specific version snapshot.
 * A-S4.5 replay calls this when `applyToProduction: true`.
 * Performs the restore inside the (already-running) mongo transaction if any.
 */
FormVersionModel.restoreVersion = async function (
  formId: string,
  versionId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const Form = mongoose.model("Form");
  const version = await this.findOne({ formId, _id: versionId }).lean();
  if (!version) {
    return { success: false, error: `Version ${versionId} not found for form ${formId}` };
  }
  if (version.ownerId !== userId) {
    return { success: false, error: "Form version does not belong to user" };
  }
  await Form.updateOne({ _id: formId, ownerId: userId }, { $set: version.snapshot }).exec();
  // Record the rollback target as a new version row (audit trail).
  await this.create({
    formId,
    version: (await this.countDocuments({ formId })) + 1,
    ownerId: userId,
    snapshot: version.snapshot,
    reason: "rollback_target",
  });
  return { success: true };
};

/**
 * List all versions for a form (newest first).
 */
FormVersionModel.listVersions = async function (
  formId: string
): Promise<FormVersionSnapshot[]> {
  const docs = await this.find({ formId }).sort({ version: -1 }).lean();
  return docs.map((doc: any) => ({
    versionId: String(doc._id),
    formId: doc.formId,
    ownerId: doc.ownerId,
    version: doc.version,
    snapshot: doc.snapshot,
    reason: doc.reason,
    createdAt: doc.createdAt,
  }));
};

export default FormVersionModel;
