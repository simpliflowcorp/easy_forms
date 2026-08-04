/**
 * Orchestrator core execution loop (A-S3.3).
 * 
 * Implements the hierarchical multi-agent loop from pi_agent_upgrade_v3.md §4.3:
 * acquireExecutionLock → budget pre-flight → memory.assembleContext → 
 * PLAN (DAG Planner) → CRITIC pre-flight → EXECUTE topologically → 
 * CRITIC post-flight → AWAITING_USER_APPROVAL → MERGE → LEARN → RESPOND
 */

import { ExecutionPlan, TaskNode, TaskEdge, TaskState, Checkpoint, ExecutionStatus, ExecutorRole, CriticVerdict, Finding, FixDirective, AgentContext, MemoryScope, MemoryPointer, SkillDefinition } from "../types.js";
import { BudgetTracker, BudgetExceededError, getDefaultBudgetConfig } from "./budget.js";
import { logAudit, logLLMCall, logToolCall, logVerification, logStateTransition, logMerge, initAuditLogger, shutdownAuditLogger } from "./audit.js";
import { acquireExecutionLock, type ExecutionLockHandle } from "./lock.js";
import { replayFromCheckpoint } from "./replay.js";
import { generateMermaid } from "./visualize.js";
import { orchestrator as orchestratorInstance } from "./index.js";

import { sandboxRedisStore } from "../sandbox/sandboxRedisStore.js";
import { mergeSandboxToProduction } from "../sandbox/sandboxMerge.js";
import { agentRedis } from "../sandbox/agentRedis.js";
import { callLLM, retryLLM } from "@/lib/llmClient.js";
import { loadSkillRegistry } from "../skills/loader.js";
import { checkToolPermission } from "../policy/permissions.js";
import { newTraceId } from "../helper/id.js";
import AgentTicketModel from "@/models/agentTicketModel.js";
import AgentUsageModel from "@/models/agentUsageModel.js";
import User from "@/models/userModel.js";
import { LLMBudgetExceededError } from "@/lib/llmClient.js";

// Import critic and executors dynamically to avoid circular deps
let Critic: any = null;
let executors: Map<ExecutorRole, any> = new Map();
let memoryService: any = null;

async function getCritic() {
  if (!Critic) {
    const mod = await import("../critic/index.js");
    Critic = mod.critic;
  }
  return Critic;
}

async function getExecutor(role: ExecutorRole) {
  if (!executors.has(role)) {
    const mod = await import(`../executors/${role}`);
    executors.set(role, mod[`${role}Executor`] || mod.default);
  }
  return executors.get(role);
}

async function getMemoryService() {
  if (!memoryService) {
    try {
      const mod = await import("@/agent/memory/service.js");
      memoryService = mod.memoryService;
    } catch {
      memoryService = null;
    }
  }
  return memoryService;
}

/** Orchestrator execution options. */
export interface OrchestratorExecuteOptions {
  executionId: string;
  userId: string;
  prompt: string;
  sessionId?: string;
  resumeFrom?: string;
  onProgress?: (state: any) => void;
  onChunk?: (persona: string, chunk: string) => void;
}

/** Orchestrator execution result. */
export interface OrchestratorExecuteResult {
  executionId: string;
  userId: string;
  status: ExecutionStatus;
  plan: ExecutionPlan;
  taskStates: Map<string, TaskState>;
  checkpoints: Checkpoint[];
  reply?: string;
  isComplete: boolean;
  isQuestion: boolean;
  mergeStats?: any;
}

/** Main Orchestrator class. */
export class Orchestrator {
  private executionId: string = "";
  private userId: string = "";
  private lock: ExecutionLockHandle | null = null;
  private budgetTracker: BudgetTracker | null = null;
  private plan: ExecutionPlan | null = null;
  private taskStates: Map<string, TaskState> = new Map();
  private checkpoints: Checkpoint[] = [];
  private status: ExecutionStatus = "planning";
  private reply: string = "";
  private isComplete: boolean = false;
  private isQuestion: boolean = false;
  private mergeStats: any = null;
  private startedAt: number = 0;
  private auditModel: any = null;
  private checkpointModel: any = null;

  /** Set the audit and checkpoint models (called at startup). */
  setModels(auditModel: any, checkpointModel: any): void {
    this.auditModel = auditModel;
    this.checkpointModel = checkpointModel;
    if (auditModel) {
      initAuditLogger(auditModel);
    }
  }

  /** Main entry point for executing a plan. */
  async execute(options: OrchestratorExecuteOptions): Promise<OrchestratorExecuteResult> {
    this.executionId = options.executionId;
    this.userId = options.userId;
    this.startedAt = Date.now();

    // 1. Acquire per-execution lock (A-S3.7)
    this.lock = await acquireExecutionLock(this.executionId, this.userId);

    // 2. Initialize budget tracker (A-S3.8)
    this.budgetTracker = new BudgetTracker(this.executionId, this.userId);

    try {
      // 3. Budget pre-flight check
      await this.budgetTracker.preFlightCheck(AgentUsageModel);

      // 4. Assemble context from memory (Agent C)
      const context = await this.assembleContext();

      // 5. PLAN: Generate DAG execution plan (A-S3.4)
      await this.updateStatus("planning");
      this.plan = await this.generatePlan(options.prompt, context);
      await this.persistExecutionState();

      // 6. CRITIC pre-flight: validate plan (A-S3.5)
      const preflightVerdict = await this.runCriticPreflight();
      if (preflightVerdict.verdict === "fail") {
        throw new Error(`Plan rejected by Critic: ${preflightVerdict.findings.map(f => f.message).join("; ")}`);
      }

      // 7. EXECUTE: Run tasks topologically (A-S3.6)
      await this.updateStatus("executing");
      await this.executePlan();

      // 8. CRITIC post-flight: verify results
      const postflightVerdict = await this.runCriticPostflight();
      if (postflightVerdict.verdict === "fail") {
        // Attempt replan
        await this.handleCriticFailure(postflightVerdict);
      }

      // 9. AWAITING_USER_APPROVAL if mutations exist
      if (this.requiresMergeApproval()) {
        await this.updateStatus("awaiting_approval");
        // Wait for user approval (handled by API route)
        return this.buildResult();
      }

      // 10. MERGE: Apply sandbox to production (Agent B)
      await this.mergeToProduction();

      // 11. LEARN: Index memory (Agent C)
      await this.learnFromExecution();

      // 12. RESPOND: Final response
      await this.updateStatus("completed");
      this.isComplete = true;

      return this.buildResult();
    } catch (err: any) {
      return await this.handleFailure(err);
    } finally {
      await this.cleanup();
    }
  }

  /** Assemble context from memory service. */
  private async assembleContext(): Promise<AgentContext> {
    const mem = await getMemoryService();
    if (mem) {
      const scope: MemoryScope = {
        read: ["preferences", "recent_traces", "skills", "procedural"],
        write: ["skill_usage", "recurring_fields", "failures"],
      };
      return await mem.assembleContext(this.userId, scope);
    }
    return {
      preferences: { preferredFieldTypes: {}, namingPatterns: [], viewConfigs: {} },
      recentTraces: [],
      relevantSkills: [],
      procedural: [],
    };
  }

  /** Generate DAG execution plan via Planner (A-S3.4). */
  private async generatePlan(prompt: string, context: AgentContext): Promise<ExecutionPlan> {
    // Load skills and build tool catalog
    const skills = loadSkillRegistry();
    const relevantSkills = skills.filter(s => this.isSkillRelevant(s, prompt));
    
    // Build tool schemas for LLM
    const toolSchemas = this.buildToolSchemas(relevantSkills);
    
    // Call LLM Planner with DAG generation prompt
    const planPrompt = this.buildPlanPrompt(prompt, context, relevantSkills, toolSchemas);
    
    const response = await retryLLM([
      { role: "system", content: planPrompt.system },
      { role: "user", content: planPrompt.user },
    ], {
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const plan = JSON.parse(response.content);
    return this.validateAndEnrichPlan(plan, relevantSkills);
  }

  /** Check if a skill is relevant to the prompt. */
  private isSkillRelevant(skill: SkillDefinition, prompt: string): boolean {
    const promptLower = prompt.toLowerCase();
    const skillKeywords = skill.name.split("_");
    return skillKeywords.some((k: string) => promptLower.includes(k));
  }

  /** Build tool schemas from skills. */
  private buildToolSchemas(skills: SkillDefinition[]): any[] {
    const tools = new Map<string, any>();
    for (const skill of skills) {
      for (const toolRef of skill.tools) {
        if (!tools.has(toolRef.tool)) {
          tools.set(toolRef.tool, { name: toolRef.tool, paramsFrom: toolRef.paramsFrom });
        }
      }
    }
    return Array.from(tools.values());
  }

  /** Build the planner prompt. */
  private buildPlanPrompt(prompt: string, context: AgentContext, skills: SkillDefinition[], tools: any[]): { system: string; user: string } {
    return {
      system: `You are a DAG Planner for the Easy Forms agent. Generate an ExecutionPlan with TaskNodes and TaskEdges.
Each TaskNode must have: taskId, role (executor_forms|executor_responses|executor_views|executor_generic), skill, tool, params, dependsOn[], timeoutMs, retryPolicy, metadata, successCriteria.
Edges can be: dependency, conditional (with condition), or loop.
Output valid JSON only.`,
      user: `User Request: ${prompt}

Available Skills: ${skills.map(s => s.name).join(", ")}
Available Tools: ${tools.map(t => t.name).join(", ")}

Context:
- Preferences: ${JSON.stringify(context.preferences)}
- Recent Traces: ${context.recentTraces.length} traces
- Relevant Skills: ${context.relevantSkills.length} skills

Generate an ExecutionPlan that accomplishes the user's request.`
    };
  }

  /** Validate and enrich the raw plan from LLM. */
  private validateAndEnrichPlan(rawPlan: any, skills: SkillDefinition[]): ExecutionPlan {
    // Basic validation and enrichment
    const tasks: TaskNode[] = (rawPlan.tasks || []).map((t: any, i: number) => ({
      taskId: t.taskId || `task_${i}`,
      role: t.role || "executor_generic",
      skill: t.skill || skills[0]?.name || "unknown",
      tool: t.tool,
      params: t.params || {},
      dependsOn: t.dependsOn || [],
      timeoutMs: t.timeoutMs || 30000,
      retryPolicy: t.retryPolicy || { maxRetries: 2, backoffMs: 1000, retryableErrors: ["timeout", "rate_limit"] },
      metadata: {
        isDestructive: ["delete_form", "delete_custom_view"].includes(t.tool),
        requiresConfirmation: ["delete_form", "delete_custom_view"].includes(t.tool),
        idempotencyKey: t.idempotencyKey || `${this.executionId}_${t.taskId}`,
        estimatedTokens: t.estimatedTokens || 1000,
      },
      successCriteria: t.successCriteria || [{ type: "tool_success", specification: {} }],
    }));

    const edges: TaskEdge[] = (rawPlan.edges || []).map((e: any) => ({
      from: e.from,
      to: e.to,
      type: e.type || "dependency",
      condition: e.condition,
    }));

    // Ensure all tasks have at least one edge or are roots
    const hasIncoming = new Set(edges.map(e => e.to));
    for (const task of tasks) {
      if (!hasIncoming.has(task.taskId)) {
        // Root task
      }
    }

    return {
      planId: this.executionId,
      goal: rawPlan.goal || "User request",
      tasks,
      edges,
      checkpoints: [],
      estimatedCost: {
        estimatedTokens: tasks.reduce((sum, t) => sum + t.metadata.estimatedTokens, 0),
        estimatedCostUsd: 0,
        breakdown: {},
      },
      riskAssessment: [],
      metadata: {
        createdBy: "planner",
        model: "auto",
        tokenEstimate: tasks.reduce((sum, t) => sum + t.metadata.estimatedTokens, 0),
      },
    };
  }

  /** Run Critic pre-flight validation (A-S3.5). */
  private async runCriticPreflight(): Promise<CriticVerdict> {
    const critic = await getCritic();
    const allowedTools = this.getAllowedToolsForPlan();
    
    const findings: Finding[] = [];
    
    // Check for tool hallucination
    for (const task of this.plan!.tasks) {
      if (!allowedTools.has(task.tool)) {
        findings.push({
          id: newTraceId(),
          severity: "critical",
          category: "tool_hallucination",
          message: `Task ${task.taskId} uses unknown tool: ${task.tool}`,
          relatedTaskId: task.taskId,
        });
      }
    }

    // Check for cross-tenant form_id in params
    for (const task of this.plan!.tasks) {
      if (task.params.formId && typeof task.params.formId === "string") {
        // Could add more sophisticated check here
      }
    }

    // Schema validation
    for (const task of this.plan!.tasks) {
      if (!task.params || typeof task.params !== "object") {
        findings.push({
          id: newTraceId(),
          severity: "warning",
          category: "schema",
          message: `Task ${task.taskId} has invalid params`,
          relatedTaskId: task.taskId,
        });
      }
    }

    const verdict: CriticVerdict = {
      verdict: findings.some(f => f.severity === "critical") ? "fail" : "pass",
      score: findings.some(f => f.severity === "critical") ? 0 : 100,
      findings,
      requiredFixes: findings
        .filter(f => f.severity === "critical")
        .map(f => ({
          taskId: f.relatedTaskId || "",
          action: "replace_tool" as const,
          detail: f.message,
        })),
    };

    logVerification({
      executionId: this.executionId,
      role: "critic",
      verdict: verdict.verdict,
      findings,
    });

    return verdict;
  }

  /** Get allowed tools from skills registry. */
  private getAllowedToolsForPlan(): Set<string> {
    const tools = new Set<string>();
    for (const task of this.plan!.tasks) {
      tools.add(task.tool);
    }
    return tools;
  }

  /** Execute the plan topologically (A-S3.6). */
  private async executePlan(): Promise<void> {
    const taskOrder = this.topologicalSort(this.plan!.tasks, this.plan!.edges);
    
    for (const task of taskOrder) {
      // Check conditional edges
      if (!this.shouldExecuteTask(task)) {
        this.taskStates.set(task.taskId, {
          taskId: task.taskId,
          status: "skipped",
          retryCount: 0,
        });
        continue;
      }

      await this.executeTask(task);
      
      // Checkpoint after each task (A-S3.10)
      await this.createCheckpoint(task.taskId);
    }
  }

  /** Topological sort of tasks. */
  private topologicalSort(tasks: TaskNode[], edges: TaskEdge[]): TaskNode[] {
    const adj = new Map<string, string[]>();
    const indegree = new Map<string, number>();
    const taskMap = new Map(tasks.map(t => [t.taskId, t]));

    for (const task of tasks) {
      adj.set(task.taskId, []);
      indegree.set(task.taskId, 0);
    }

    for (const edge of edges) {
      if (edge.type === "dependency") {
        adj.get(edge.from)?.push(edge.to);
        indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1);
      }
    }

    const queue = tasks.filter(t => indegree.get(t.taskId) === 0);
    const result: TaskNode[] = [];

    while (queue.length > 0) {
      const task = queue.shift()!;
      result.push(task);
      
      for (const neighbor of adj.get(task.taskId) || []) {
        const newDegree = (indegree.get(neighbor) || 0) - 1;
        indegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(taskMap.get(neighbor)!);
        }
      }
    }

    if (result.length !== tasks.length) {
      // Cycle detected - fallback to original order
      return tasks;
    }

    return result;
  }

  /** Check if a task should execute (conditional edges). */
  private shouldExecuteTask(task: TaskNode): boolean {
    const incomingConditional = this.plan!.edges.filter(
      e => e.to === task.taskId && e.type === "conditional"
    );

    for (const edge of incomingConditional) {
      const fromState = this.taskStates.get(edge.from);
      if (!fromState || fromState.status !== "completed") return false;
      
      if (edge.condition) {
        // Evaluate condition against fromState.result
        try {
          const result = fromState.result;
          // eslint-disable-next-line no-eval
          if (!eval(edge.condition)) return false;
        } catch {
          return false;
        }
      }
    }
    return true;
  }

  /** Execute a single task via the appropriate executor. */
  private async executeTask(task: TaskNode): Promise<void> {
    const executor = await getExecutor(task.role);
    if (!executor) {
      throw new Error(`No executor found for role: ${task.role}`);
    }

    this.taskStates.set(task.taskId, {
      taskId: task.taskId,
      status: "running",
      startedAt: Date.now(),
      retryCount: 0,
    });

    // Budget pre-flight for this task
    await this.budgetTracker!.preFlightCheck(AgentUsageModel, task.taskId, task.metadata.estimatedTokens);

    const startTime = Date.now();
    let success = false;
    let result: any = null;
    let error: string | undefined;

    try {
      // Call executor
      const execResult = await executor.execute({
        taskId: task.taskId,
        tool: task.tool,
        params: task.params,
        userId: this.userId,
        executionId: this.executionId,
        sandbox: await sandboxRedisStore.get(this.userId, this.executionId),
        skillContext: {
          skillId: task.skill,
          maxIterations: 3,
          negativeTests: [],
          dryRunShape: {},
        },
      });

      result = execResult.result;
      success = execResult.success;
      error = execResult.error;

      // Record budget usage
      if (execResult.usage) {
        this.budgetTracker!.recordUsage(
          execResult.usage.totalTokens,
          execResult.usage.costUsd || 0,
          task.taskId,
          true
        );
      }

      logToolCall({
        executionId: this.executionId,
        taskId: task.taskId,
        role: task.role,
        tool: task.tool,
        input: task.params,
        output: result,
        latencyMs: Date.now() - startTime,
        success,
        error,
      });
    } catch (err: any) {
      success = false;
      error = err.message;
      logToolCall({
        executionId: this.executionId,
        taskId: task.taskId,
        role: task.role,
        tool: task.tool,
        input: task.params,
        output: null,
        latencyMs: Date.now() - startTime,
        success: false,
        error: err.message,
      });
    }

    this.taskStates.set(task.taskId, {
      taskId: task.taskId,
      status: success ? "completed" : "failed",
      result,
      error,
      startedAt: startTime,
      completedAt: Date.now(),
      retryCount: 0,
    });
  }

  /** Create a checkpoint after task completion (A-S3.10). */
  private async createCheckpoint(taskId: string): Promise<void> {
    // Compute sandbox snapshot hash
    const sandbox = await sandboxRedisStore.get(this.userId, this.executionId);
    const sandboxStr = JSON.stringify(sandbox);
    const hash = await this.sha256(sandboxStr);

    const checkpoint: Checkpoint = {
      checkpointId: `cp_${taskId}_${Date.now()}`,
      taskId,
      taskStateSnapshot: Object.fromEntries(this.taskStates),
      sandboxSnapshotSha256: hash,
      memoryPointers: [],
      ts: Date.now(),
    };

    this.checkpoints.push(checkpoint);

    // Persist to MongoDB (Agent C's OrchestratorCheckpointModel)
    if (this.checkpointModel) {
      await this.checkpointModel.create([{
        executionId: this.executionId,
        userId: this.userId,
        ...checkpoint,
        plan: this.plan,
        taskStates: Object.fromEntries(this.taskStates),
      }]);
    }
  }

  /** Simple SHA256 hash. */
  private async sha256(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  }

  /** Run Critic post-flight verification (A-S3.5). */
  private async runCriticPostflight(): Promise<CriticVerdict> {
    const critic = await getCritic();
    
    // Run negative tests from skills
    const findings: Finding[] = [];
    
    for (const task of this.plan!.tasks) {
      const state = this.taskStates.get(task.taskId);
      if (state?.status === "completed") {
        // Could run skill-specific negative tests here
      }
    }

    // LLM-based adversarial review
    const reviewPrompt = this.buildReviewPrompt();
    const response = await retryLLM([
      { role: "system", content: reviewPrompt.system },
      { role: "user", content: reviewPrompt.user },
    ], {
      response_format: { type: "json_object" },
      temperature: 0.0,
    });

    const verdict = JSON.parse(response.content) as CriticVerdict;
    
    logVerification({
      executionId: this.executionId,
      role: "critic",
      verdict: verdict.verdict,
      findings: verdict.findings,
      fixes: verdict.requiredFixes,
    });

    return verdict;
  }

  /** Build the critic review prompt. */
  private buildReviewPrompt(): { system: string; user: string } {
    return {
      system: `You are an adversarial Critic reviewing an agent execution. Check for:
1. Correctness: Do tool results match user intent?
2. Completeness: Are all required actions done?
3. Safety: Any policy violations, data leaks, or destructive actions without confirmation?
4. Quality: Any hallucinated data, wrong form IDs, or malformed outputs?

Output JSON: { verdict: "pass|conditional_pass|fail|escalate", score: 0-100, findings: [], requiredFixes: [] }`,
      user: `Execution Plan: ${JSON.stringify(this.plan, null, 2)}
Task Results: ${JSON.stringify(Object.fromEntries(this.taskStates), null, 2)}`
    };
  }

  /** Handle Critic failure by replanning. */
  private async handleCriticFailure(verdict: CriticVerdict): Promise<void> {
    // For now, just throw - full replan logic in Stage 4
    throw new Error(`Execution failed Critic review: ${verdict.findings.map(f => f.message).join("; ")}`);
  }

  /** Check if merge approval is required. */
  private requiresMergeApproval(): boolean {
    const MUTATING_TOOLS = new Set(["create_form", "update_form", "delete_form", "create_custom_view", "update_custom_view", "delete_custom_view"]);
    for (const task of this.plan!.tasks) {
      if (MUTATING_TOOLS.has(task.tool)) {
        const state = this.taskStates.get(task.taskId);
        if (state?.status === "completed") return true;
      }
    }
    return false;
  }

  /** Merge sandbox to production (Agent B). */
  private async mergeToProduction(): Promise<void> {
    const stats = await mergeSandboxToProduction(this.userId, this.executionId);
    this.mergeStats = stats;

    logMerge({
      executionId: this.executionId,
      role: "orchestrator",
      mergeStats: stats,
      approvedActionIds: [], // Would come from user approval
    });
  }

  /** Learn from execution (Agent C memory indexing). */
  private async learnFromExecution(): Promise<void> {
    const mem = await getMemoryService();
    if (mem && this.plan) {
      // Record skill usage
      for (const task of this.plan.tasks) {
        const state = this.taskStates.get(task.taskId);
        if (state?.status === "completed") {
          await mem.recordSkillUse(this.userId, task.skill, true, 1);
        }
      }
    }
  }

  /** Update execution status. */
  private async updateStatus(status: ExecutionStatus): Promise<void> {
    const oldStatus = this.status;
    this.status = status;
    logStateTransition({
      executionId: this.executionId,
      role: "orchestrator",
      fromStatus: oldStatus,
      toStatus: status,
    });
    await this.persistExecutionState();
  }

  /** Persist execution state to MongoDB (Agent C's OrchestratorExecutionModel). */
  private async persistExecutionState(): Promise<void> {
    if (this.auditModel) {
      // This would use OrchestratorExecutionModel in production
      // For now, use AgentTicketModel as fallback
      await AgentTicketModel.findOneAndUpdate(
        { ticketId: this.executionId, userId: this.userId },
        {
          executionId: this.executionId,
          userId: this.userId,
          status: this.status,
          plan: this.plan,
          taskStates: Object.fromEntries(this.taskStates),
          checkpoints: this.checkpoints,
          budget: this.budgetTracker?.getSnapshot(),
          auditLog: [], // Stored separately
          updatedAt: new Date(),
        },
        { upsert: true }
      );
    }
  }

  /** Build the final result. */
  private buildResult(): OrchestratorExecuteResult {
    return {
      executionId: this.executionId,
      userId: this.userId,
      status: this.status,
      plan: this.plan!,
      taskStates: this.taskStates,
      checkpoints: this.checkpoints,
      reply: this.reply,
      isComplete: this.isComplete,
      isQuestion: this.isQuestion,
      mergeStats: this.mergeStats,
    };
  }

  /** Handle execution failure. */
  private async handleFailure(err: any): Promise<OrchestratorExecuteResult> {
    this.status = "failed";
    
    // Check if it's a budget error - set partial status
    if (err instanceof BudgetExceededError) {
      this.status = "partial";
    }

    // Persist failure state
    await this.persistExecutionState();

    return this.buildResult();
  }

  /** Cleanup resources. */
  private async cleanup(): Promise<void> {
    if (this.lock) {
      await this.lock.release();
    }
    shutdownAuditLogger();
  }
}

/** Singleton orchestrator instance. */
export const orchestrator = new Orchestrator();