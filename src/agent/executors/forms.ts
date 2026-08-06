/**
 * Forms Executor — handles form mutation tools (A-S3.6).
 * 
 * Tools: create_form, update_form, delete_form, set_form_status, update_form_metadata_settings
 * All mutations go through the sandbox for isolation and idempotency.
 */

import { ExecutorBase, ExecutorInput, ExecutorOutput } from "./base";
import { sandboxRedisStore } from "../sandbox/sandboxRedisStore";
import { newIdempotencyKey } from "../helper/id";
import mongoose from "mongoose";
import Form from "../../models/formModel.js";
import { logInfo, logError } from "@/lib/logger";

export class FormsExecutor extends ExecutorBase {
  readonly role = "executor_forms" as const;
  readonly tools = [
    "create_form",
    "update_form",
    "delete_form",
    "set_form_status",
    "update_form_metadata_settings",
    "read_form",
  ] as const;

  async execute(input: ExecutorInput): Promise<ExecutorOutput> {
    const { action, sandbox, userId, executionId, taskId, skillContext } = input;
    const tool = action.tool;
    const params = action.params;

    try {
      switch (tool) {
        case "create_form":
          return await this.createForm(action, params, sandbox, userId, executionId, taskId);
        case "update_form":
          return await this.updateForm(action, params, sandbox, userId, executionId, taskId);
        case "delete_form":
          return await this.deleteForm(action, params, sandbox, userId, executionId, taskId);
        case "set_form_status":
          return await this.setFormStatus(action, params, sandbox, userId, executionId, taskId);
        case "update_form_metadata_settings":
          return await this.updateFormMetadata(action, params, sandbox, userId, executionId, taskId);
        case "read_form":
          return await this.readForm(action, params, userId);
        default:
          throw new Error(`Unknown tool: ${tool}`);
      }
    } catch (err: any) {
      logError(`[FormsExecutor] ${tool} failed`, { error: err.message, taskId });
      return {
        sandbox,
        action: { ...action, status: "error", error: err.message },
        success: false,
        error: err.message,
      };
    }
  }

  /** Create a new form draft in sandbox. */
  private async createForm(
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
      name: params.name,
      description: params.description,
      elements: params.elements || [],
      status: params.status || 1,
      expiryDays: params.expiryDays,
      metadataSettings: params.metadataSettings || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Add to sandbox
    const updatedSandbox = { ...sandbox };
    updatedSandbox.forms = { ...sandbox.forms, [idempotencyKey]: draft };
    await sandboxRedisStore.set(userId, executionId, updatedSandbox);

    logInfo("[FormsExecutor] Form draft created", { taskId, idempotencyKey, formName: params.name });

    return {
      sandbox: updatedSandbox,
      action: { ...action, status: "done", result: { formId: draft._id, idempotencyKey } },
      success: true,
    };
  }

  /** Update an existing form draft in sandbox. */
  private async updateForm(
    action: any,
    params: any,
    sandbox: any,
    userId: string,
    executionId: string,
    taskId: string
  ): Promise<ExecutorOutput> {
    const { formId, updates, expectedUpdatedAt, idempotencyKey } = params;
    
    if (!formId || !updates) {
      throw new Error("update_form requires formId and updates");
    }

    // Find the draft in sandbox
    const draftKey = Object.keys(sandbox.forms).find(k => 
      sandbox.forms[k]._id === formId || sandbox.forms[k].formId === formId
    );

    if (!draftKey) {
      throw new Error(`Form draft not found in sandbox: ${formId}`);
    }

    const draft = sandbox.forms[draftKey];
    
    // Optimistic concurrency check
    if (expectedUpdatedAt && draft.updatedAt && new Date(draft.updatedAt).getTime() !== new Date(expectedUpdatedAt).getTime()) {
      throw new Error(`Form was modified concurrently (expectedUpdatedAt mismatch)`);
    }

    // Apply updates
    const updatedDraft = {
      ...draft,
      ...updates,
      updatedAt: new Date(),
      idempotencyKey: draft.idempotencyKey || idempotencyKey || newIdempotencyKey(),
    };

    const updatedSandbox = { ...sandbox };
    updatedSandbox.forms = { ...sandbox.forms, [draftKey]: updatedDraft };
    
    // Also track as pending update for merge
    updatedSandbox.updates = [...(sandbox.updates || []), {
      id: formId,
      updates,
      expectedUpdatedAt: expectedUpdatedAt ? new Date(expectedUpdatedAt) : undefined,
      idempotencyKey: updatedDraft.idempotencyKey,
    }];

    await sandboxRedisStore.set(userId, executionId, updatedSandbox);

    logInfo("[FormsExecutor] Form draft updated", { taskId, formId });

    return {
      sandbox: updatedSandbox,
      action: { ...action, status: "done", result: { formId, updated: true } },
      success: true,
    };
  }

  /** Delete a form draft from sandbox. */
  private async deleteForm(
    action: any,
    params: any,
    sandbox: any,
    userId: string,
    executionId: string,
    taskId: string
  ): Promise<ExecutorOutput> {
    const { formId, expectedUpdatedAt, idempotencyKey } = params;
    
    if (!formId) {
      throw new Error("delete_form requires formId");
    }

    // Find the draft in sandbox
    const draftKey = Object.keys(sandbox.forms).find(k => 
      sandbox.forms[k]._id === formId || sandbox.forms[k].formId === formId
    );

    if (draftKey) {
      // Remove from sandbox forms
      const updatedSandbox = { ...sandbox };
      const { [draftKey]: removed, ...remainingForms } = updatedSandbox.forms;
      updatedSandbox.forms = remainingForms;
      
      // Track as pending delete for merge
      updatedSandbox.deletes = [...(sandbox.deletes || []), {
        id: formId,
        expectedUpdatedAt: expectedUpdatedAt ? new Date(expectedUpdatedAt) : undefined,
        idempotencyKey: idempotencyKey || newIdempotencyKey(),
      }];

      await sandboxRedisStore.set(userId, executionId, updatedSandbox);

      logInfo("[FormsExecutor] Form draft deleted", { taskId, formId });

      return {
        sandbox: updatedSandbox,
        action: { ...action, status: "done", result: { formId, deleted: true } },
        success: true,
      };
    }

    // If not in sandbox, queue as delete for merge (production form)
    const updatedSandbox = { ...sandbox };
    updatedSandbox.deletes = [...(sandbox.deletes || []), {
      id: formId,
      expectedUpdatedAt: expectedUpdatedAt ? new Date(expectedUpdatedAt) : undefined,
      idempotencyKey: idempotencyKey || newIdempotencyKey(),
    }];

    await sandboxRedisStore.set(userId, executionId, updatedSandbox);

    return {
      sandbox: updatedSandbox,
      action: { ...action, status: "done", result: { formId, queuedForDelete: true } },
      success: true,
    };
  }

  /** Set form status (active/paused/archived). */
  private async setFormStatus(
    action: any,
    params: any,
    sandbox: any,
    userId: string,
    executionId: string,
    taskId: string
  ): Promise<ExecutorOutput> {
    const { formId, status } = params;
    
    if (!formId || !status) {
      throw new Error("set_form_status requires formId and status");
    }

    // Queue as metadata update for merge
    const updatedSandbox = { ...sandbox };
    updatedSandbox.updates = [...(sandbox.updates || []), {
      id: formId,
      updates: { status },
      idempotencyKey: newIdempotencyKey(),
    }];

    await sandboxRedisStore.set(userId, executionId, updatedSandbox);

    logInfo("[FormsExecutor] Form status change queued", { taskId, formId, status });

    return {
      sandbox: updatedSandbox,
      action: { ...action, status: "done", result: { formId, status } },
      success: true,
    };
  }

  /** Update form metadata settings (IP/UA/geo/referrer tracking). */
  private async updateFormMetadata(
    action: any,
    params: any,
    sandbox: any,
    userId: string,
    executionId: string,
    taskId: string
  ): Promise<ExecutorOutput> {
    const { formId, metadataSettings } = params;
    
    if (!formId || !metadataSettings) {
      throw new Error("update_form_metadata_settings requires formId and metadataSettings");
    }

    const updatedSandbox = { ...sandbox };
    updatedSandbox.updates = [...(sandbox.updates || []), {
      id: formId,
      updates: { metadataSettings },
      idempotencyKey: newIdempotencyKey(),
    }];

    await sandboxRedisStore.set(userId, executionId, updatedSandbox);

    logInfo("[FormsExecutor] Form metadata update queued", { taskId, formId });

    return {
      sandbox: updatedSandbox,
      action: { ...action, status: "done", result: { formId, metadataSettings } },
      success: true,
    };
  }

  /** Read form (direct read, no sandbox). */
  private async readForm(action: any, params: any, userId: string): Promise<ExecutorOutput> {
    const { formId } = params;
    const form = await Form.findOne({ _id: formId, user: userId }).lean();
    
    if (!form) {
      throw new Error(`Form not found: ${formId}`);
    }

    return {
      sandbox: { forms: {}, customViews: {}, queryResults: {}, updates: [], deletes: [] },
      action: { ...action, status: "done", result: form },
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
    // No persistent resources to clean up
  }
}

/** Singleton instance. */
export const formsExecutor = new FormsExecutor();