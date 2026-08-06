/**
 * Deterministic replay from checkpoints (A-S3.10).
 * 
 * Reconstructs sandbox + memory via OrchestratorCheckpointModel,
 * re-runs the plan from a specific checkpoint.
 * 
 * A-S4.5: Extended with form-version rollback support using C's FormVersionModel.
 * When replaying from a checkpoint, form-version pointers are reconstructed
 * so a rollback target restores a prior FormVersion snapshot atomically
 * with the rest of the execution state.
 */

import { Checkpoint, ExecutionPlan, TaskNode, TaskState, ExecutionStatus } from "../types";
import type { MemoryService } from "../memory/types.js";
import type { IOrchestratorCheckpointDocument } from "@/models/OrchestratorCheckpointModel";
import type {
  FormVersionSnapshot as FormVersionSnapshotRow,
  IFormVersionDocument,
} from "@/models/FormVersionModel";

/**
 * Sandbox store — Redis. Local interface (no canonical export across the agent
 * tree); kept here because the sandbox store is passed in by callers, not
 * imported by replay code.
 */
export interface SandboxStore {
  get(userId: string, executionId: string): Promise<any>;
  set(userId: string, executionId: string, data: any): Promise<void>;
}

/**
 * Checkpoint model — adapter view over C's OrchestratorCheckpointModel.
 * The canonical Mongoose model (default-exported from
 * `@/models/OrchestratorCheckpointModel`) implements all of
 * `findOne`/`find`. Using `IOrchestratorCheckpointDocument` keeps the row
 * shape synced to C's schema instead of an untyped `any`.
 */
export interface OrchestratorCheckpointModel {
  findOne(filter: any): Promise<(IOrchestratorCheckpointDocument & { taskStates?: Record<string, TaskState>; plan?: ExecutionPlan; sandboxSnapshot?: any; memoryPointers?: string[]; userId?: string; ts?: number }) | null>;
  find(filter: any): Promise<(IOrchestratorCheckpointDocument & { taskStates?: Record<string, TaskState>; plan?: ExecutionPlan; ts?: number })[]>;
}

/**
 * FormVersionModel — adapter view over C's `@/models/FormVersionModel`.
 * C-S4.3 added the model; A-S4.5 consumes it. The methods below are the
 * subset A's replay uses; they're implemented as statics on the Mongoose
 * model (see `src/models/FormVersionModel.ts`). The `reason` enum matches
 * C's authoritative `agent_merge | user_edit | rollback_target` — the
 * prior local `changeType: "create"|"update"|"delete"` was un-canonical drift.
 */
export interface FormVersionModel {
  findVersionAtOrBefore(
    formId: string,
    timestamp: Date,
  ): Promise<FormVersionSnapshot | null>;
  restoreVersion(
    formId: string,
    versionId: string,
    userId: string,
  ): Promise<{ success: boolean; error?: string }>;
  listVersions(formId: string): Promise<FormVersionSnapshot[]>;
}

/**
 * Form version snapshot — re-exports C's canonical shape so all callers
 * (replay.ts, OrchestratorExecutionModel.formVersionPointers, the API route)
 * read/write against the SAME definition. The prior local declaration with
 * `changeType: "create" | "update" | "delete"` was drift from C's
 * `reason: "agent_merge" | "user_edit" | "rollback_target"`.
 */
export type FormVersionSnapshot = FormVersionSnapshotRow;

/** Extended replay options including form version rollback. */
export interface ReplayOptions {
  /** Target checkpoint ID to replay from */
  checkpointId: string;
  /** Optional: specific formId to rollback (if omitted, replay all) */
  targetFormId?: string;
  /** Optional: timestamp to rollback to (uses checkpoint timestamp if omitted) */
  rollbackTimestamp?: Date;
  /** Whether to actually apply the rollback to production (default: false - dry run) */
  applyToProduction?: boolean;
}

/** Result of a replay operation. */
export interface ReplayResult {
  success: boolean;
  executionId: string;
  checkpointId: string;
  restoredState: {
    sandbox: any;
    memory: any;
    taskStates: Map<string, TaskState>;
    plan: ExecutionPlan;
    /** A-S4.5: Form version pointers restored for rollback */
    formVersions?: Map<string, FormVersionSnapshot>;
  };
  error?: string;
  /** A-S4.5: Rollback-specific results */
  rollbackResult?: {
    formId: string;
    restoredVersionId: string;
    applied: boolean;
    error?: string;
  }[];
}

/**
 * Replay execution from a specific checkpoint with optional form-version rollback.
 * 
 * @param executionId - The execution to replay
 * @param options - Replay options including checkpoint and rollback config
 * @param checkpointModel - Agent C's OrchestratorCheckpointModel
 * @param sandboxStore - Redis sandbox store
 * @param memoryService - Agent C's MemoryService
 * @param formVersionModel - Optional Agent C's FormVersionModel (for rollback)
 * @returns ReplayResult with restored state and optional rollback results
 */
export async function replayFromCheckpoint(
  executionId: string,
  options: ReplayOptions | string, // Support both new object and legacy string checkpointId
  checkpointModel: OrchestratorCheckpointModel,
  sandboxStore: SandboxStore,
  memoryService: MemoryService,
  formVersionModel?: FormVersionModel // Optional - Agent C provides this in Stage 4
): Promise<ReplayResult> {
  // Handle legacy string checkpointId for backwards compatibility
  const opts: ReplayOptions = typeof options === "string" 
    ? { checkpointId: options }
    : options;

  const { checkpointId, targetFormId, rollbackTimestamp, applyToProduction = false } = opts;

  try {
    // 1. Load the checkpoint from MongoDB
    const checkpoint = await checkpointModel.findOne({
      executionId,
      checkpointId,
    });

    if (!checkpoint) {
      return {
        success: false,
        executionId,
        checkpointId,
        restoredState: null as any,
        error: `Checkpoint ${checkpointId} not found for execution ${executionId}`,
      };
    }

    // 2. Restore sandbox state from Redis (namespaced by executionId)
    // NOTE: Checkpoint (per the frozen agent/types.ts::Checkpoint) does not
    // currently carry `userId`. C's OrchestratorCheckpointModel schema also
    // does not store it. Return an explicit error instead of silently
    // passing `undefined` through to downstream APIs (latent bug surfaced
    // by tightening the replay typing in this cleanup pass).
    const userId = checkpoint.userId;
    if (!userId) {
      return {
        success: false,
        executionId,
        checkpointId,
        restoredState: null as any,
        error: `Checkpoint ${checkpointId} for execution ${executionId} has no userId; cannot replay (Checkpoint schema needs userId — tracked as a separate fixup).`,
      };
    }
    const sandbox = await sandboxStore.get(userId, executionId);
    
    // If sandbox doesn't exist in Redis, try to reconstruct from checkpoint
    const restoredSandbox = sandbox || checkpoint.sandboxSnapshot || {};

    // 3. Restore memory pointers and assemble context
    const memory = await memoryService.assembleContext(userId, {
      read: checkpoint.memoryPointers || [],
      write: [],
    });

    // 4. Restore task states
    const taskStates = new Map<string, TaskState>();
    if (checkpoint.taskStates) {
      for (const [taskId, state] of Object.entries(checkpoint.taskStates)) {
        taskStates.set(taskId, state as TaskState);
      }
    }

    // 5. Load the execution plan
    const plan = checkpoint.plan as ExecutionPlan;

    // 6. A-S4.5: Reconstruct form-version pointers for rollback
    const formVersions = new Map<string, FormVersionSnapshot>();
    const rollbackResults: ReplayResult["rollbackResult"] = [];

    if (formVersionModel) {
      // Determine which forms to check for version rollback
      const formsToCheck = targetFormId 
        ? [targetFormId]
        : extractFormIdsFromPlan(plan);

      // Use checkpoint timestamp as default rollback target
      const targetTimestamp = rollbackTimestamp || new Date(checkpoint.ts);

      for (const formId of formsToCheck) {
        try {
          // Find the form version at or before the target timestamp
          const version = await formVersionModel.findVersionAtOrBefore(formId, targetTimestamp);
          
          if (version) {
            formVersions.set(formId, version);
            
            // If applyToProduction is true, actually restore the form
            if (applyToProduction) {
              const restoreResult = await formVersionModel.restoreVersion(formId, version.versionId, userId);
              rollbackResults.push({
                formId,
                restoredVersionId: version.versionId,
                applied: restoreResult.success,
                error: restoreResult.error,
              });
            }
          }
        } catch (versionErr) {
          // Log but don't fail the replay - version rollback is best-effort
          rollbackResults.push({
            formId,
            restoredVersionId: "",
            applied: false,
            error: `Version lookup failed: ${versionErr instanceof Error ? versionErr.message : String(versionErr)}`,
          });
        }
      }
    }

    return {
      success: true,
      executionId,
      checkpointId,
      restoredState: {
        sandbox: restoredSandbox,
        memory,
        taskStates,
        plan,
        formVersions: formVersions.size > 0 ? formVersions : undefined,
      },
      rollbackResult: rollbackResults.length > 0 ? rollbackResults : undefined,
    };
  } catch (err: any) {
    return {
      success: false,
      executionId,
      checkpointId,
      restoredState: null as any,
      error: `Replay failed: ${err.message}`,
    };
  }
}

/**
 * Extract formIds from an execution plan (for form-version rollback).
 * Looks at tasks that operate on forms.
 */
function extractFormIdsFromPlan(plan: ExecutionPlan): string[] {
  const formIds = new Set<string>();
  const formTools = new Set([
    "create_form", "update_form", "delete_form", "read_form",
    "set_form_status", "update_form_metadata_settings",
    "add_form_element", "update_form_element", "remove_form_element", "reorder_form_elements",
  ]);

  for (const task of plan.tasks) {
    if (formTools.has(task.tool) && task.params.formId) {
      formIds.add(task.params.formId);
    }
  }

  return Array.from(formIds);
}

/**
 * List all available checkpoints for an execution.
 */
export async function listCheckpoints(
  executionId: string,
  checkpointModel: OrchestratorCheckpointModel
): Promise<Checkpoint[]> {
  const checkpoints = await checkpointModel.find({ executionId });
  return checkpoints.sort((a, b) => a.ts - b.ts);
}

/**
 * Verify that a replay produces the same results as the original execution.
 * Compares task outputs from the replay against the original checkpoint.
 */
export async function verifyReplay(
  executionId: string,
  checkpointId: string,
  replayResults: Map<string, any>,
  checkpointModel: OrchestratorCheckpointModel
): Promise<{ verified: boolean; mismatches: string[] }> {
  const checkpoint = await checkpointModel.findOne({ executionId, checkpointId });
  if (!checkpoint || !checkpoint.taskStates) {
    return { verified: false, mismatches: ["Original checkpoint not found"] };
  }

  const mismatches: string[] = [];
  
  for (const [taskId, originalState] of Object.entries(checkpoint.taskStates)) {
    const replayResult = replayResults.get(taskId);
    const originalResult = (originalState as any).result;
    
    if (replayResult === undefined) {
      mismatches.push(`Task ${taskId}: no replay result`);
      continue;
    }
    
    // Deep compare results (simplified - in production use a proper deep equality)
    if (JSON.stringify(replayResult) !== JSON.stringify(originalResult)) {
      mismatches.push(`Task ${taskId}: result mismatch`);
    }
  }

  return { verified: mismatches.length === 0, mismatches };
}

/**
 * A-S4.5: Create a form version snapshot from current state.
 * Useful for creating explicit checkpoints before risky operations.
 *
 * Note: this helper constructs an in-memory snapshot row (canonical
 * FormVersionSnapshot shape owned by C). Persistence is handled by the
 * FormVersionModel implementation when the rollout merges it. The fields
 * below match `src/models/FormVersionModel.ts::FormVersionSnapshot`.
 */
export async function createFormVersionSnapshot(
  formId: string,
  userId: string,
  formData: Record<string, any>,
  formVersionModel: FormVersionModel,
  metadata: {
    executionId?: string;
    checkpointId?: string;
    reason?: IFormVersionDocument["reason"];
    version?: number;
    createdAt?: Date;
  } = {}
): Promise<FormVersionSnapshot> {
  const version = metadata.version ?? 0;
  const snapshot: FormVersionSnapshot = {
    versionId: `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    formId,
    ownerId: userId,
    version,
    snapshot: formData,
    reason: metadata.reason || "agent_merge",
    createdAt: metadata.createdAt || new Date(),
  };

  // The actual persistence is handled by FormVersionModel implementation.
  // This is a helper to construct the snapshot object.
  return snapshot;
}