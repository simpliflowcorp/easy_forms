/**
 * Budget tracker for Orchestrator executions (A-S3.8).
 * 
 * Enforces token budgets at per-execution, per-task, and per-user-day granularity.
 * Throws BudgetExceededError on overflow, which the orchestrator catches to
 * checkpoint state and set status="partial".
 */

import { BudgetSnapshot, BudgetConfig } from "../types";

/** Custom error for budget overflow — distinct from LLMBudgetExceededError. */
export class BudgetExceededError extends Error {
  public readonly budgetType: "per_execution" | "per_task" | "per_user_day" | "per_tool_call";
  public readonly current: number;
  public readonly limit: number;

  constructor(
    budgetType: "per_execution" | "per_task" | "per_user_day" | "per_tool_call",
    current: number,
    limit: number
  ) {
    super(
      `Budget exceeded: ${budgetType} (current: ${current}, limit: ${limit})`
    );
    this.name = "BudgetExceededError";
    this.budgetType = budgetType;
    this.current = current;
    this.limit = limit;
  }
}

/** Default budget configuration (can be overridden via env). */
export function getDefaultBudgetConfig(): BudgetConfig {
  return {
    perExecution: Number(process.env.ORCHESTRATOR_BUDGET_PER_EXECUTION || "100000"),
    perTask: Number(process.env.ORCHESTRATOR_BUDGET_PER_TASK || "20000"),
    perUserDay: Number(process.env.ORCHESTRATOR_BUDGET_PER_USER_DAY || "500000"),
    perToolCall: Number(process.env.ORCHESTRATOR_BUDGET_PER_TOOL_CALL || "5000"),
  };
}

/** Budget tracker class for a single execution. */
export class BudgetTracker {
  private config: BudgetConfig;
  private snapshot: BudgetSnapshot;
  private userId: string;
  private executionId: string;

  constructor(
    executionId: string,
    userId: string,
    config: Partial<BudgetConfig> = {}
  ) {
    this.executionId = executionId;
    this.userId = userId;
    this.config = { ...getDefaultBudgetConfig(), ...config };
    this.snapshot = {
      totalTokens: 0,
      totalCostUsd: 0,
      perTask: {},
      perUserDay: 0,
      limits: {
        perTicket: this.config.perExecution,
        perUserDay: this.config.perUserDay,
        perToolCall: this.config.perToolCall,
      },
    };
  }

  /** Get the current budget snapshot. */
  getSnapshot(): BudgetSnapshot {
    return { ...this.snapshot };
  }

  /** Record token usage from an LLM call or tool execution. */
  recordUsage(
    tokens: number,
    costUsd: number,
    taskId?: string,
    toolCall: boolean = false
  ): void {
    this.snapshot.totalTokens += tokens;
    this.snapshot.totalCostUsd += costUsd;

    if (taskId) {
      if (!this.snapshot.perTask[taskId]) {
        this.snapshot.perTask[taskId] = { tokens: 0, costUsd: 0 };
      }
      this.snapshot.perTask[taskId].tokens += tokens;
      this.snapshot.perTask[taskId].costUsd += costUsd;

      // Check per-task budget
      if (this.snapshot.perTask[taskId].tokens > this.config.perTask) {
        throw new BudgetExceededError(
          "per_task",
          this.snapshot.perTask[taskId].tokens,
          this.config.perTask
        );
      }
    }

    // Check per-tool-call budget
    if (toolCall && tokens > this.config.perToolCall) {
      throw new BudgetExceededError(
        "per_tool_call",
        tokens,
        this.config.perToolCall
      );
    }

    // Check per-execution budget
    if (this.snapshot.totalTokens > this.config.perExecution) {
      throw new BudgetExceededError(
        "per_execution",
        this.snapshot.totalTokens,
        this.config.perExecution
      );
    }
  }

  /** Check and update per-user-day budget from MongoDB. */
  async checkUserDayBudget(AgentUsageModel: any): Promise<void> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todayUsage = await AgentUsageModel.aggregate([
      { $match: { userId: this.userId, createdAt: { $gte: startOfDay } } },
      { $group: { _id: null, total: { $sum: "$totalTokens" } } },
    ]);

    const todayTotal = todayUsage[0]?.total || 0;
    this.snapshot.perUserDay = todayTotal;

    if (todayTotal >= this.config.perUserDay) {
      throw new BudgetExceededError(
        "per_user_day",
        todayTotal,
        this.config.perUserDay
      );
    }
  }

  /** Pre-flight check before starting a task or tool call. */
  async preFlightCheck(AgentUsageModel: any, taskId?: string, estimatedTokens: number = 0): Promise<void> {
    // Check per-user-day budget
    await this.checkUserDayBudget(AgentUsageModel);

    // Check per-execution budget with estimation
    if (this.snapshot.totalTokens + estimatedTokens > this.config.perExecution) {
      throw new BudgetExceededError(
        "per_execution",
        this.snapshot.totalTokens + estimatedTokens,
        this.config.perExecution
      );
    }

    // Check per-task budget with estimation
    if (taskId && this.snapshot.perTask[taskId]) {
      if (this.snapshot.perTask[taskId].tokens + estimatedTokens > this.config.perTask) {
        throw new BudgetExceededError(
          "per_task",
          this.snapshot.perTask[taskId].tokens + estimatedTokens,
          this.config.perTask
        );
      }
    }
  }

  /** Merge another tracker's usage (e.g., from a sub-execution). */
  merge(other: BudgetTracker): void {
    this.snapshot.totalTokens += other.snapshot.totalTokens;
    this.snapshot.totalCostUsd += other.snapshot.totalCostUsd;
    
    for (const [taskId, usage] of Object.entries(other.snapshot.perTask)) {
      if (!this.snapshot.perTask[taskId]) {
        this.snapshot.perTask[taskId] = { tokens: 0, costUsd: 0 };
      }
      this.snapshot.perTask[taskId].tokens += usage.tokens;
      this.snapshot.perTask[taskId].costUsd += usage.costUsd;
    }
  }
}