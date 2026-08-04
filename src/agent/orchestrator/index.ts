/**
 * Orchestrator module index (A-S3.3).
 * 
 * Exports the singleton orchestrator instance and related types.
 */

export { Orchestrator, orchestrator, type OrchestratorExecuteOptions, type OrchestratorExecuteResult } from "./loop";
export { acquireExecutionLock, type ExecutionLockHandle } from "./lock";
export { BudgetTracker, BudgetExceededError, getDefaultBudgetConfig } from "./budget";
export { 
  logAudit, 
  logLLMCall, 
  logToolCall, 
  logVerification, 
  logStateTransition, 
  logMerge, 
  initAuditLogger, 
  shutdownAuditLogger 
} from "./audit";
export { replayFromCheckpoint, listCheckpoints, verifyReplay } from "./replay";
export { 
  generateMermaid, 
  generateMermaidSummary, 
  generateMermaidTrace,
  visualize 
} from "./visualize";
export { runAgentLoopLegacy, isV3Enabled, getAgentRunner } from "./legacyShim";