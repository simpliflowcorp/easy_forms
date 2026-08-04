/**
 * CriticBase — abstract base class for the Stage 3 Critic role.
 * 
 * The Critic is an adversarial reviewer that evaluates the Orchestrator's
 * plan and execution results. It:
 * - Runs structural negative tests (from skill.negativeTests) pre-execution
 * - Performs semantic QA on tool results (LLM-based, like current Evaluator)
 * - Checks for policy violations, security issues, data quality problems
 * - Emits a CriticVerdict: pass / conditional_pass / fail / escalate
 * - On fail, provides FixDirectives for the Orchestrator to replan
 * 
 * Stage 2: Empty scaffold — no implementation. Stage 3 fills this.
 */
import type { CriticVerdict, Finding, FixDirective } from "../types";

export interface CriticInput {
  /** The execution plan to review. */
  plan: any; // ExecutionPlan
  /** Current task states and results. */
  taskStates: Map<string, any>; // TaskState
  /** The skill definitions for the tasks being reviewed. */
  skills: Map<string, any>; // SkillDefinition
  /** User context and memory. */
  context: any; // AgentContext
}

export interface CriticOptions {
  /** Whether to run LLM-based semantic QA (slower but deeper). */
  runSemanticQA: boolean;
  /** Whether to run structural negative tests (fast, deterministic). */
  runNegativeTests: boolean;
  /** Custom policy rules to enforce. */
  policyRules?: string[];
}

/**
 * Abstract base class for the Critic role.
 * Implementations provide the review logic; the Orchestrator calls review()
 * at checkpoints and after task completion.
 */
export abstract class CriticBase {
  /** Unique identifier for this critic instance. */
  abstract readonly criticId: string;

  /**
   * Review an execution plan and/or results.
   * Returns a CriticVerdict with findings and required fixes.
   */
  abstract review(input: CriticInput, options?: CriticOptions): Promise<CriticVerdict>;

  /**
   * Run structural negative tests from skill definitions.
   * Fast, deterministic, no LLM call.
   */
  abstract runNegativeTests(input: CriticInput): Promise<Finding[]>;

  /**
   * Run semantic QA using an LLM.
   * Slower but catches issues negative tests miss.
   */
  abstract runSemanticQA(input: CriticInput): Promise<Finding[]>;

  /**
   * Check for policy violations (permissions, data access, etc.).
   */
  abstract checkPolicy(input: CriticInput): Promise<Finding[]>;

  /**
   * Synthesize findings into a verdict and fix directives.
   */
  abstract synthesize(findings: Finding[]): CriticVerdict;
}