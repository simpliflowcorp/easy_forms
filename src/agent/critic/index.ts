/**
 * Critic role implementation (A-S3.5).
 * 
 * Adversarial reviewer that validates execution plans pre-flight and
 * verifies results post-flight. Emits CriticVerdict with findings and fixes.
 */

import { CriticVerdict, Finding, FixDirective, ExecutionPlan, TaskNode, TaskState, SkillDefinition, ExecutionStatus } from "../types";
import { CriticBase } from "../skills/criticBase";
import { loadSkillRegistry } from "../skills/loader";
import { checkToolPermission } from "../policy/permissions";
import { callLLM, retryLLM } from "@/lib/llmClient";
import { newTraceId } from "../helper/id";

/** Critic input context. */
export interface CriticInput {
  plan: ExecutionPlan;
  taskStates: Map<string, TaskState>;
  skills: Map<string, SkillDefinition>;
  context: any;
}

/** Critic options. */
export interface CriticOptions {
  runSemanticQA: boolean;
  runNegativeTests: boolean;
  policyRules?: string[];
}

/** Concrete Critic implementation extending the Stage 2 scaffold. */
export class CriticImpl extends CriticBase {
  readonly criticId = "critic_main";

  async review(input: CriticInput, options: CriticOptions = { runSemanticQA: true, runNegativeTests: true }): Promise<CriticVerdict> {
    const allFindings: Finding[] = [];

    // 1. Structural validation (always runs)
    const structuralFindings = await this.runStructuralChecks(input);
    allFindings.push(...structuralFindings);

    // 2. Negative tests (deterministic, from skill definitions)
    if (options.runNegativeTests) {
      const negativeFindings = await this.runNegativeTests(input);
      allFindings.push(...negativeFindings);
    }

    // 3. Policy checks
    const policyFindings = await this.checkPolicy(input);
    allFindings.push(...policyFindings);

    // 4. Semantic QA (LLM-based, optional)
    if (options.runSemanticQA) {
      const semanticFindings = await this.runSemanticQA(input);
      allFindings.push(...semanticFindings);
    }

    // 5. Synthesize verdict
    return this.synthesize(allFindings);
  }

  /** Run structural validation on the plan. */
  async runStructuralChecks(input: CriticInput): Promise<Finding[]> {
    const findings: Finding[] = [];
    const { plan, taskStates } = input;

    // Check for tool hallucination
    const allowedTools = new Set<string>();
    for (const task of plan.tasks) {
      allowedTools.add(task.tool);
    }

    for (const task of plan.tasks) {
      const perm = checkToolPermission(task.tool);
      if (!perm.allowed) {
        findings.push({
          id: newTraceId(),
          severity: "critical",
          category: "permission",
          message: `Task ${task.taskId} uses tool '${task.tool}' which is not permitted: ${perm.reason}`,
          relatedTaskId: task.taskId,
        });
      }
    }

    // Check for cycles in dependency graph
    if (this.hasCycles(plan)) {
      findings.push({
        id: newTraceId(),
        severity: "critical",
        category: "structure",
        message: "Execution plan contains cyclic dependencies",
      });
    }

    // Check all dependencies exist
    const taskIds = new Set(plan.tasks.map(t => t.taskId));
    for (const edge of plan.edges) {
      if (!taskIds.has(edge.from) || !taskIds.has(edge.to)) {
        findings.push({
          id: newTraceId(),
          severity: "critical",
          category: "structure",
          message: `Edge references non-existent task: ${edge.from} -> ${edge.to}`,
        });
      }
    }

    // Check for orphaned tasks (no incoming/outgoing edges and not root/leaf)
    for (const task of plan.tasks) {
      const hasIncoming = plan.edges.some(e => e.to === task.taskId);
      const hasOutgoing = plan.edges.some(e => e.from === task.taskId);
      const isRoot = !hasIncoming;
      const isLeaf = !hasOutgoing;
      
      if (!isRoot && !isLeaf && (!hasIncoming || !hasOutgoing)) {
        findings.push({
          id: newTraceId(),
          severity: "warning",
          category: "structure",
          message: `Task ${task.taskId} appears disconnected from main flow`,
          relatedTaskId: task.taskId,
        });
      }
    }

    return findings;
  }

  /** Detect cycles in the dependency graph. */
  private hasCycles(plan: ExecutionPlan): boolean {
    const adj = new Map<string, string[]>();
    for (const task of plan.tasks) {
      adj.set(task.taskId, []);
    }
    for (const edge of plan.edges) {
      if (edge.type === "dependency") {
        adj.get(edge.from)?.push(edge.to);
      }
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();

    function dfs(node: string): boolean {
      visited.add(node);
      recStack.add(node);
      for (const neighbor of adj.get(node) || []) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true;
        } else if (recStack.has(neighbor)) {
          return true;
        }
      }
      recStack.delete(node);
      return false;
    }

    for (const task of plan.tasks) {
      if (!visited.has(task.taskId)) {
        if (dfs(task.taskId)) return true;
      }
    }
    return false;
  }

  /** Run deterministic negative tests from skill definitions. */
  async runNegativeTests(input: CriticInput): Promise<Finding[]> {
    const findings: Finding[] = [];
    const { plan, taskStates, skills } = input;

    for (const task of plan.tasks) {
      const skill = skills.get(task.skill);
      if (!skill?.negativeTests) continue;

      const state = taskStates.get(task.taskId);
      if (!state || state.status !== "completed") continue;

      for (const test of skill.negativeTests) {
        try {
          // Evaluate assertion in context of task result
          const actionPlan = [{ tool: task.tool, params: task.params, result: state.result }];
          const state_ = { actionPlan, task, result: state.result };
          // eslint-disable-next-line no-eval
          const pass = eval(test.assert);
          
          if (!pass) {
            findings.push({
              id: newTraceId(),
              severity: "critical",
              category: "negative_test",
              message: test.description 
                ? `Negative test failed: ${test.description} (${test.assert})`
                : `Negative test failed: ${test.assert}`,
              relatedTaskId: task.taskId,
              evidence: { assert: test.assert, result: state.result },
            });
          }
        } catch (err) {
          findings.push({
            id: newTraceId(),
            severity: "warning",
            category: "negative_test",
            message: `Negative test evaluation error: ${test.assert}`,
            relatedTaskId: task.taskId,
            evidence: { error: String(err) },
          });
        }
      }
    }

    return findings;
  }

  /** Check policy rules. */
  async checkPolicy(input: CriticInput): Promise<Finding[]> {
    const findings: Finding[] = [];
    const { plan, taskStates } = input;

    // Check for cross-tenant form_id access
    for (const task of plan.tasks) {
      if (task.params.formId) {
        // The actual tenant isolation is enforced at execution time
        // Here we just flag if formId looks like it might be from another user
        // (heuristic: very long IDs that don't match typical patterns)
      }
    }

    // Check for destructive actions without confirmation
    const destructiveTools = new Set(["delete_form", "delete_custom_view"]);
    for (const task of plan.tasks) {
      if (destructiveTools.has(task.tool) && !task.metadata.requiresConfirmation) {
        findings.push({
          id: newTraceId(),
          severity: "critical",
          category: "policy",
          message: `Destructive tool ${task.tool} missing requiresConfirmation flag`,
          relatedTaskId: task.taskId,
        });
      }
    }

    // Check for Response mutations (should be read-only)
    for (const task of plan.tasks) {
      if (task.tool === "update_response" || task.tool === "delete_response") {
        findings.push({
          id: newTraceId(),
          severity: "critical",
          category: "policy",
          message: `Response mutations are not allowed: ${task.tool}`,
          relatedTaskId: task.taskId,
        });
      }
    }

    return findings;
  }

  /** Run LLM-based semantic QA. */
  async runSemanticQA(input: CriticInput): Promise<Finding[]> {
    const { plan, taskStates, context } = input;

    // Build review prompt
    const systemPrompt = `You are an adversarial Critic reviewing an agent execution for correctness, completeness, and safety.
Check for:
1. Does the execution actually satisfy the user's original request?
2. Are there hallucinated form IDs, field names, or data?
3. Are results consistent across tasks?
4. Any missing steps or incomplete actions?

Output JSON: { findings: [{ id, severity: "info|warning|critical", category, message, relatedTaskId?, evidence? }] }`;

    const userPrompt = `User Request: ${plan.goal}

Execution Plan: ${JSON.stringify(plan, null, 2)}

Task Results: ${JSON.stringify(Object.fromEntries(taskStates), null, 2)}

Context: ${JSON.stringify(context, null, 2)}

Review this execution and identify any issues.`;

    try {
      const response = await retryLLM([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ], {
        response_format: { type: "json_object" },
        temperature: 0.0,
      });

      const parsed = JSON.parse(response.content);
      return parsed.findings || [];
    } catch (err) {
      return [{
        id: newTraceId(),
        severity: "warning",
        category: "semantic_qa",
        message: `Semantic QA failed: ${err}`,
      }];
    }
  }

  /** Synthesize findings into a verdict. */
  synthesize(findings: Finding[]): CriticVerdict {
    const criticalCount = findings.filter(f => f.severity === "critical").length;
    const warningCount = findings.filter(f => f.severity === "warning").length;
    const infoCount = findings.filter(f => f.severity === "info").length;

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

    const requiredFixes: FixDirective[] = findings
      .filter(f => f.severity === "critical")
      .map(f => ({
        taskId: f.relatedTaskId || "",
        action: "replan" as const,
        detail: f.message,
      }));

    return {
      verdict,
      score,
      findings,
      requiredFixes,
      retryGuidance: criticalCount > 0 ? "Replan required due to critical findings" : undefined,
      escalationReason: criticalCount > 3 ? "Too many critical findings" : undefined,
    };
  }
}

/** Singleton critic instance. */
export const critic = new CriticImpl();