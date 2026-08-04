/**
 * Deterministic replay from checkpoints (A-S3.10).
 * 
 * Reconstructs sandbox + memory via OrchestratorCheckpointModel,
 * re-runs the plan from a specific checkpoint.
 */

import { Checkpoint, ExecutionPlan, TaskNode, TaskState, ExecutionStatus } from "../types";

/** Interface for the checkpoint model (Agent C's OrchestratorCheckpointModel). */
export interface OrchestratorCheckpointModel {
  findOne(filter: any): Promise<any>;
  find(filter: any): Promise<any[]>;
}

/** Interface for the sandbox store (Redis). */
export interface SandboxStore {
  get(userId: string, executionId: string): Promise<any>;
  set(userId: string, executionId: string, data: any): Promise<void>;
}

/** Interface for the memory service (Agent C). */
export interface MemoryService {
  assembleContext(userId: string, scope: any): Promise<any>;
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
  };
  error?: string;
}

/**
 * Replay execution from a specific checkpoint.
 * 
 * @param executionId - The execution to replay
 * @param checkpointId - The checkpoint to replay from
 * @param checkpointModel - Agent C's OrchestratorCheckpointModel
 * @param sandboxStore - Redis sandbox store
 * @param memoryService - Agent C's MemoryService
 * @returns ReplayResult with restored state
 */
export async function replayFromCheckpoint(
  executionId: string,
  checkpointId: string,
  checkpointModel: OrchestratorCheckpointModel,
  sandboxStore: SandboxStore,
  memoryService: MemoryService
): Promise<ReplayResult> {
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
    const userId = checkpoint.userId; // Stored in checkpoint
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

    return {
      success: true,
      executionId,
      checkpointId,
      restoredState: {
        sandbox: restoredSandbox,
        memory,
        taskStates,
        plan,
      },
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