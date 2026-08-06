/**
 * Views Executor — handles custom view tools (A-S3.6).
 * 
 * Tools: create_custom_view, update_custom_view, delete_custom_view, get_custom_views
 * Mutations go through the sandbox; reads are direct.
 */

import { ExecutorBase, ExecutorInput, ExecutorOutput } from "./base";
import { sandboxRedisStore } from "../sandbox/sandboxRedisStore";
import { newIdempotencyKey } from "../helper/id";
import mongoose from "mongoose";
import CustomView from "../../models/customViewModel.js";
import { logInfo, logError } from "@/lib/logger";

export class ViewsExecutor extends ExecutorBase {
  readonly role = "executor_views" as const;
  readonly tools = [
    "create_custom_view",
    "update_custom_view",
    "delete_custom_view",
    "get_custom_views",
  ] as const;

  async execute(input: ExecutorInput): Promise<ExecutorOutput> {
    const { action, sandbox, userId, executionId, taskId } = input;
    const tool = action.tool;
    const params = action.params;

    try {
      switch (tool) {
        case "create_custom_view":
          return await this.createView(action, params, sandbox, userId, executionId, taskId);
        case "update_custom_view":
          return await this.updateView(action, params, sandbox, userId, executionId, taskId);
        case "delete_custom_view":
          return await this.deleteView(action, params, sandbox, userId, executionId, taskId);
        case "get_custom_views":
          return await this.getViews(action, params, userId, sandbox);
        default:
          throw new Error(`Unknown tool: ${tool}`);
      }
    } catch (err: any) {
      logError(`[ViewsExecutor] ${tool} failed`, { error: err.message, taskId });
      return {
        sandbox,
        action: { ...action, status: "error", error: err.message },
        success: false,
        error: err.message,
      };
    }
  }

  /** Create a new custom view draft in sandbox. */
  private async createView(
    action: any,
    params: any,
    sandbox: any,
    userId: string,
    executionId: string,
    taskId: string
  ): Promise<ExecutorOutput> {
    const idempotencyKey = params.idempotencyKey || newIdempotencyKey();
    
    const draft = {
      idempotencyKey,
      _id: new mongoose.Types.ObjectId().toString(),
      isSandboxDraft: true,
      user: userId,
      formId: params.formId,
      name: params.name,
      filters: params.filters || [],
      sortField: params.sortField || "submitted_at",
      sortOrder: params.sortOrder || "desc",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updatedSandbox = { ...sandbox };
    updatedSandbox.customViews = { ...sandbox.customViews, [idempotencyKey]: draft };
    await sandboxRedisStore.set(userId, executionId, updatedSandbox);

    logInfo("[ViewsExecutor] Custom view draft created", { taskId, idempotencyKey, viewName: params.name });

    return {
      sandbox: updatedSandbox,
      action: { ...action, status: "done", result: { viewId: draft._id, idempotencyKey } },
      success: true,
    };
  }

  /** Update an existing custom view draft in sandbox. */
  private async updateView(
    action: any,
    params: any,
    sandbox: any,
    userId: string,
    executionId: string,
    taskId: string
  ): Promise<ExecutorOutput> {
    const { formId, name, filters, sortField, sortOrder, expectedUpdatedAt, idempotencyKey } = params;
    
    if (!formId || !name) {
      throw new Error("update_custom_view requires formId and name");
    }

    // Find the draft in sandbox
    const draftKey = Object.keys(sandbox.customViews).find(k => 
      sandbox.customViews[k].formId === formId && sandbox.customViews[k].name === name
    );

    if (!draftKey) {
      throw new Error(`Custom view draft not found in sandbox: ${formId}/${name}`);
    }

    const draft = sandbox.customViews[draftKey];
    
    // Optimistic concurrency check
    if (expectedUpdatedAt && draft.updatedAt && new Date(draft.updatedAt).getTime() !== new Date(expectedUpdatedAt).getTime()) {
      throw new Error(`Custom view was modified concurrently (expectedUpdatedAt mismatch)`);
    }

    const updatedDraft = {
      ...draft,
      filters: filters || draft.filters,
      sortField: sortField || draft.sortField,
      sortOrder: sortOrder || draft.sortOrder,
      updatedAt: new Date(),
      idempotencyKey: draft.idempotencyKey || idempotencyKey || newIdempotencyKey(),
    };

    const updatedSandbox = { ...sandbox };
    updatedSandbox.customViews = { ...sandbox.customViews, [draftKey]: updatedDraft };
    
    // Track as pending update for merge
    updatedSandbox.updates = [...(sandbox.updates || []), {
      id: `${formId}:${name}`,
      updates: { filters: updatedDraft.filters, sortField: updatedDraft.sortField, sortOrder: updatedDraft.sortOrder },
      expectedUpdatedAt: expectedUpdatedAt ? new Date(expectedUpdatedAt) : undefined,
      idempotencyKey: updatedDraft.idempotencyKey,
    }];

    await sandboxRedisStore.set(userId, executionId, updatedSandbox);

    logInfo("[ViewsExecutor] Custom view draft updated", { taskId, formId, name });

    return {
      sandbox: updatedSandbox,
      action: { ...action, status: "done", result: { formId, name, updated: true } },
      success: true,
    };
  }

  /** Delete a custom view draft from sandbox. */
  private async deleteView(
    action: any,
    params: any,
    sandbox: any,
    userId: string,
    executionId: string,
    taskId: string
  ): Promise<ExecutorOutput> {
    const { formId, name, expectedUpdatedAt, idempotencyKey } = params;
    
    if (!formId || !name) {
      throw new Error("delete_custom_view requires formId and name");
    }

    const draftKey = Object.keys(sandbox.customViews).find(k => 
      sandbox.customViews[k].formId === formId && sandbox.customViews[k].name === name
    );

    if (draftKey) {
      const updatedSandbox = { ...sandbox };
      const { [draftKey]: removed, ...remainingViews } = updatedSandbox.customViews;
      updatedSandbox.customViews = remainingViews;
      
      updatedSandbox.deletes = [...(sandbox.deletes || []), {
        id: `${formId}:${name}`,
        expectedUpdatedAt: expectedUpdatedAt ? new Date(expectedUpdatedAt) : undefined,
        idempotencyKey: idempotencyKey || newIdempotencyKey(),
      }];

      await sandboxRedisStore.set(userId, executionId, updatedSandbox);

      logInfo("[ViewsExecutor] Custom view draft deleted", { taskId, formId, name });

      return {
        sandbox: updatedSandbox,
        action: { ...action, status: "done", result: { formId, name, deleted: true } },
        success: true,
      };
    }

    // Queue as delete for merge
    const updatedSandbox = { ...sandbox };
    updatedSandbox.deletes = [...(sandbox.deletes || []), {
      id: `${formId}:${name}`,
      expectedUpdatedAt: expectedUpdatedAt ? new Date(expectedUpdatedAt) : undefined,
      idempotencyKey: idempotencyKey || newIdempotencyKey(),
    }];

    await sandboxRedisStore.set(userId, executionId, updatedSandbox);

    return {
      sandbox: updatedSandbox,
      action: { ...action, status: "done", result: { formId, name, queuedForDelete: true } },
      success: true,
    };
  }

  /** Get custom views (read-only). */
  private async getViews(action: any, params: any, userId: string, sandbox: any): Promise<ExecutorOutput> {
    const { formId } = params;
    const views = await CustomView.find({ user: userId, formId }).lean();
    
    return {
      sandbox,
      action: { ...action, status: "done", result: { views } },
      success: true,
    };
  }

  async dryRun(action: any, skillContext: any): Promise<Record<string, unknown>> {
    return {
      tool: action.tool,
      params: action.params,
      preview: `Would ${action.tool} with params: ${JSON.stringify(action.params)}`,
    };
  }

  async cleanup(): Promise<void> {
    // No persistent resources
  }
}

/** Singleton instance. */
export const viewsExecutor = new ViewsExecutor();

// Fix: reference to input.sandbox in getViews
// Need to fix that