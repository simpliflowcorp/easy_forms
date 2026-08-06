/**
 * Responses Executor — handles response query and analytics tools (A-S3.6).
 * 
 * Tools: query_responses, generate_analytics, export_form, run_database_query
 * All are read-only operations (no sandbox mutations needed).
 */

import { ExecutorBase, ExecutorInput, ExecutorOutput } from "./base";
import { executeAgentTool } from "@/lib/agentTools";
import { logInfo, logError } from "@/lib/logger";

export class ResponsesExecutor extends ExecutorBase {
  readonly role = "executor_responses" as const;
  readonly tools = [
    "query_responses",
    "generate_analytics",
    "export_form",
    "run_database_query",
  ] as const;

  async execute(input: ExecutorInput): Promise<ExecutorOutput> {
    const { action, userId, taskId } = input;
    const tool = action.tool;
    const params = action.params;

    try {
      // All response tools are read-only, execute directly via agentTools
      const result = await executeAgentTool(tool, params, userId);
      
      logInfo(`[ResponsesExecutor] ${tool} completed`, { taskId, resultCount: Array.isArray(result?.results) ? result.results.length : 1 });

      return {
        sandbox: input.sandbox, // No sandbox changes for read-only tools
        action: { ...action, status: "done", result },
        success: true,
      };
    } catch (err: any) {
      logError(`[ResponsesExecutor] ${tool} failed`, { error: err.message, taskId });
      return {
        sandbox: input.sandbox,
        action: { ...action, status: "error", error: err.message },
        success: false,
        error: err.message,
      };
    }
  }

  async dryRun(action: any, skillContext: any): Promise<Record<string, unknown>> {
    return {
      tool: action.tool,
      params: action.params,
      preview: `Would ${action.tool} (read-only)`,
    };
  }

  async cleanup(): Promise<void> {
    // No persistent resources
  }
}

/** Singleton instance. */
export const responsesExecutor = new ResponsesExecutor();