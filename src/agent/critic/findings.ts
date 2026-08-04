/**
 * Critic findings factories (A-S3.5).
 * 
 * Helper functions for creating Finding, FixDirective, and CriticVerdict objects.
 */

import { Finding, FixDirective, CriticVerdict, SuccessCriterion } from "../types";
import { newTraceId } from "../helper/id";

/** Create a Finding with auto-generated ID. */
export function createFinding(params: {
  severity: "info" | "warning" | "critical";
  category: string;
  message: string;
  relatedTaskId?: string;
  evidence?: any;
}): Finding {
  return {
    id: newTraceId(),
    severity: params.severity,
    category: params.category,
    message: params.message,
    relatedTaskId: params.relatedTaskId,
    evidence: params.evidence,
  };
}

/** Create a FixDirective. */
export function createFixDirective(params: {
  taskId: string;
  action: "retry" | "replan" | "replace_tool" | "adjust_params";
  detail: string;
}): FixDirective {
  return {
    taskId: params.taskId,
    action: params.action,
    detail: params.detail,
  };
}

/** Create a CriticVerdict from findings. */
export function createVerdict(params: {
  findings: Finding[];
  requiredFixes?: FixDirective[];
  retryGuidance?: string;
  escalationReason?: string;
}): CriticVerdict {
  const criticalCount = params.findings.filter(f => f.severity === "critical").length;
  const warningCount = params.findings.filter(f => f.severity === "warning").length;

  let verdict: CriticVerdict["verdict"];
  let score: number;

  if (criticalCount > 0) {
    verdict = "fail";
    score = Math.max(0, 100 - criticalCount * 20 - warningCount * 5);
  } else if (warningCount > 0) {
    verdict = "conditional_pass";
    score = Math.max(50, 100 - warningCount * 10);
  } else {
    verdict = "pass";
    score = 100;
  }

  return {
    verdict,
    score,
    findings: params.findings,
    requiredFixes: params.requiredFixes || params.findings
      .filter(f => f.severity === "critical")
      .map(f => createFixDirective({
        taskId: f.relatedTaskId || "",
        action: "replan",
        detail: f.message,
      })),
    retryGuidance: params.retryGuidance,
    escalationReason: params.escalationReason,
  };
}

/** Create a success criterion. */
export function createSuccessCriterion(params: {
  type: "tool_success" | "schema_match" | "value_check" | "custom";
  specification: any;
}): SuccessCriterion {
  return {
    type: params.type,
    specification: params.specification,
  };
}

/** Common finding factories for reuse. */
export const findings = {
  /** Tool not in allowlist. */
  toolHallucination: (taskId: string, tool: string) => createFinding({
    severity: "critical",
    category: "tool_hallucination",
    message: `Task ${taskId} uses unknown tool: ${tool}`,
    relatedTaskId: taskId,
  }),

  /** Cross-tenant form access. */
  crossTenantAccess: (taskId: string, formId: string) => createFinding({
    severity: "critical",
    category: "security",
    message: `Task ${taskId} references form_id ${formId} which may not belong to user`,
    relatedTaskId: taskId,
    evidence: { formId },
  }),

  /** Missing confirmation for destructive action. */
  missingConfirmation: (taskId: string, tool: string) => createFinding({
    severity: "critical",
    category: "policy",
    message: `Destructive tool ${tool} missing requiresConfirmation flag`,
    relatedTaskId: taskId,
  }),

  /** Response mutation attempt. */
  responseMutation: (taskId: string, tool: string) => createFinding({
    severity: "critical",
    category: "policy",
    message: `Response mutations are not allowed: ${tool}`,
    relatedTaskId: taskId,
  }),

  /** Negative test failure. */
  negativeTestFailed: (taskId: string, assert: string, description?: string) => createFinding({
    severity: "critical",
    category: "negative_test",
    message: description 
      ? `Negative test failed: ${description} (${assert})`
      : `Negative test failed: ${assert}`,
    relatedTaskId: taskId,
    evidence: { assert },
  }),

  /** Cyclic dependency. */
  cyclicDependency: () => createFinding({
    severity: "critical",
    category: "structure",
    message: "Execution plan contains cyclic dependencies",
  }),

  /** Orphaned task. */
  orphanedTask: (taskId: string) => createFinding({
    severity: "warning",
    category: "structure",
    message: `Task ${taskId} appears disconnected from main flow`,
    relatedTaskId: taskId,
  }),

  /** Hallucinated data in results. */
  hallucinatedData: (taskId: string, field: string) => createFinding({
    severity: "warning",
    category: "quality",
    message: `Task ${taskId} result contains potentially hallucinated data in field: ${field}`,
    relatedTaskId: taskId,
  }),

  /** Incomplete execution. */
  incompleteExecution: (taskId: string, missing: string) => createFinding({
    severity: "warning",
    category: "completeness",
    message: `Task ${taskId} incomplete: missing ${missing}`,
    relatedTaskId: taskId,
  }),

  /** Schema validation failure. */
  schemaValidation: (taskId: string, error: string) => createFinding({
    severity: "warning",
    category: "schema",
    message: `Task ${taskId} schema validation failed: ${error}`,
    relatedTaskId: taskId,
  }),
};

/** Common fix directive factories. */
export const fixes = {
  retry: (taskId: string, reason: string) => createFixDirective({
    taskId,
    action: "retry",
    detail: reason,
  }),

  replan: (taskId: string, reason: string) => createFixDirective({
    taskId,
    action: "replan",
    detail: reason,
  }),

  replaceTool: (taskId: string, oldTool: string, newTool: string) => createFixDirective({
    taskId,
    action: "replace_tool",
    detail: `Replace ${oldTool} with ${newTool}`,
  }),

  adjustParams: (taskId: string, adjustments: string) => createFixDirective({
    taskId,
    action: "adjust_params",
    detail: adjustments,
  }),
};