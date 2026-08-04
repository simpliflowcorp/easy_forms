/**
 * OrchestratorBase — abstract base class for the Stage 3 Orchestrator role.
 * 
 * The Orchestrator is the top-level coordinator that replaces the linear
 * agentLoop.ts with a DAG-based execution model. It:
 * - Decomposes high-level goals into TaskNodes (via Planner/Skill Router)
 * - Manages the execution DAG (dependencies, parallelization, checkpoints)
 * - Handles replanning on failure (via Critic verdicts)
 * - Enforces budgets (token, time, iteration) per skill and globally
 * - Emits lifecycle events (turn, checkpoint, merge) for observability
 * 
 * Stage 2: Empty scaffold — no implementation. Stage 3 fills this.
 */
export abstract class OrchestratorBase {
  /** Unique identifier for this execution. */
  abstract readonly executionId: string;

  /** The user on whose behalf this execution runs. */
  abstract readonly userId: string;

  /** Current execution status. */
  abstract status: "planning" | "executing" | "verifying" | "awaiting_approval" | "completed" | "failed" | "partial" | "cancelled";

  /** The execution plan (DAG of TaskNodes). */
  abstract plan: any; // ExecutionPlan from types.ts

  /** Per-task state snapshots. */
  abstract taskStates: Map<string, any>; // TaskState from types.ts

  /** Checkpoints for rollback/recovery. */
  abstract checkpoints: any[]; // Checkpoint[] from types.ts

  /** Budget tracking. */
  abstract budget: any; // BudgetSnapshot from types.ts

  /** Audit log of all decisions and tool calls. */
  abstract auditLog: any[]; // AuditEntry[] from types.ts

  /**
   * Start or resume execution from a given plan.
   * Returns when the execution reaches a terminal state or a checkpoint
   * requiring human approval.
   */
  abstract execute(): Promise<void>;

  /**
   * Replan from a failed task based on Critic verdict.
   * Returns a new/patched ExecutionPlan.
   */
  abstract replan(criticVerdict: any): Promise<any>; // CriticVerdict -> ExecutionPlan

  /**
   * Persist a checkpoint (task state + sandbox snapshot).
   */
  abstract checkpoint(taskId: string): Promise<void>;

  /**
   * Rollback to a previous checkpoint.
   */
  abstract rollback(checkpointId: string): Promise<void>;

  /**
   * Handle a user approval/rejection for a pending merge.
   */
  abstract handleApproval(approvedActionIds: string[]): Promise<void>;

  /**
   * Cancel the execution and release all locks.
   */
  abstract cancel(): Promise<void>;
}