/**
 * ExecutorBase — abstract base class for Stage 3 domain executors (A-S3.6).
 * 
 * Stage 3 splits the monolithic Executor persona into domain-specific
 * executors that run in parallel under the Orchestrator:
 * - executor_forms: create_form, update_form, delete_form, set_form_status, etc.
 * - executor_responses: query_responses, generate_analytics, export_form, etc.
 * - executor_views: create_custom_view, update_custom_view, delete_custom_view, get_custom_views
 * - executor_generic: run_database_query, user profile/prefs, notifications
 * 
 * Each executor:
 * - Owns a subset of tools (declared in its skill's tool list)
 * - Runs in the sandbox (mutations) or direct-read mode (queries)
 * - Reports progress via checkpoints to the Orchestrator
 * - Handles idempotency keys and optimistic concurrency (expectedUpdatedAt)
 * - Emits structured results for the Critic to verify
 */

import type { AgentAction, SandboxStoreState } from "../types";
import { getAllowedTools, checkSkillToolAllowlist, type Permissions } from "../policy/permissions";

export interface ExecutorInput {
  /** The action to execute. */
  action: AgentAction;
  /** Current sandbox state (for mutations). */
  sandbox: SandboxStoreState;
  /** User ID for tenant isolation. */
  userId: string;
  /** Execution ID for tracing. */
  executionId: string;
  /** Task ID for checkpointing. */
  taskId: string;
  /** Skill context (maxIterations, negativeTests, etc.). */
  skillContext: {
    skillId: string;
    maxIterations: number;
    negativeTests: any[];
    dryRunShape: Record<string, unknown>;
  };
}

export interface ExecutorOutput {
  /** Updated sandbox state after execution. */
  sandbox: SandboxStoreState;
  /** The action with result/error filled in. */
  action: AgentAction;
  /** Whether the action succeeded. */
  success: boolean;
  /** Any error message. */
  error?: string;
  /** Token usage from the execution. */
  usage?: { totalTokens: number; costUsd: number };
  /** Checkpoint data for rollback. */
  checkpoint?: {
    sandboxSnapshotSha256: string;
    memoryPointers: string[];
    ts: number;
  };
}

/**
 * Abstract base class for domain executors.
 * Each concrete executor (FormsExecutor, ResponsesExecutor, etc.) implements execute().
 */
export abstract class ExecutorBase {
  /** The role identifier (executor_forms, executor_responses, etc.). */
  abstract readonly role: "executor_forms" | "executor_responses" | "executor_views" | "executor_generic";

  /** The tool names this executor handles. */
  abstract readonly tools: readonly string[];

  /**
   * Execute a single action.
   * Mutations go to the sandbox; reads return results directly.
   */
  abstract execute(input: ExecutorInput): Promise<ExecutorOutput>;

  /**
   * Validate that this executor can handle the given action.
   * Uses B's getAllowedTools(role) for tool allow-list enforcement.
   */
  canHandle(action: AgentAction): boolean {
    // First check our own tool list
    if (!this.tools.includes(action.tool)) {
      return false;
    }
    
    // Then check B's centralized allow-list for this role
    const allowedTools = getAllowedTools(this.role);
    if (!allowedTools.includes(action.tool)) {
      return false;
    }
    
    return true;
  }

  /**
   * Check if a user-authored skill tool is allowed.
   * Delegates to B's checkSkillToolAllowlist(skill, userPermissions) (B-S3.2).
   */
  async checkSkillAllowlist(
    skill: { tools: { tool: string }[] },
    userPermissions: Permissions,
  ): Promise<{ allowed: boolean; reason?: string }> {
    return checkSkillToolAllowlist(skill, userPermissions);
  }

  /**
   * Prepare a dry-run preview of the action (for the Communicator's merge preview).
   * Returns the dryRunShape from the skill with concrete values filled in.
   */
  abstract dryRun(action: AgentAction, skillContext: ExecutorInput["skillContext"]): Promise<Record<string, unknown>>;

  /**
   * Cleanup after execution (release temp resources, etc.).
   */
  abstract cleanup(): Promise<void>;
}

/**
 * Dispatcher function to route an action to the correct executor.
 * Used by the Orchestrator to delegate task execution.
 */
export async function dispatchToExecutor(
  action: AgentAction,
  role: "executor_forms" | "executor_responses" | "executor_views" | "executor_generic",
  input: Omit<ExecutorInput, "action">
): Promise<ExecutorOutput> {
  // Import executors dynamically
  const mod = await import(`./${role}`);
  const executor = mod[`${role}Executor`] || mod.default;
  
  if (!executor || !executor.canHandle(action)) {
    return {
      sandbox: input.sandbox,
      action: { ...action, status: "error", error: `No executor for tool: ${action.tool}` },
      success: false,
      error: `Tool ${action.tool} not handled by ${role}`,
    };
  }

  return executor.execute({ ...input, action });
}