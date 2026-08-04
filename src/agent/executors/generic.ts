/**
 * Generic Executor — handles user/profile/notification tools and generic queries (A-S3.6).
 * 
 * Tools: run_database_query, update_user_profile, update_user_preferences, 
 *        update_notification_settings, list_notifications, mark_notification_read,
 *        clear_notification, list_agent_audit_events, list_agent_tickets
 * Mix of read-only and sandboxed mutations.
 */

import { ExecutorBase, ExecutorInput, ExecutorOutput } from "./base";
import { sandboxRedisStore } from "../sandbox/sandboxRedisStore";
import { executeAgentTool } from "@/lib/agentTools";
import { logInfo, logError } from "@/lib/logger";
import User from "../../models/userModel.js";
import mongoose from "mongoose";

export class GenericExecutor extends ExecutorBase {
  readonly role = "executor_generic" as const;
  readonly tools = [
    "run_database_query",
    "update_user_profile",
    "update_user_preferences",
    "update_notification_settings",
    "list_notifications",
    "mark_notification_read",
    "clear_notification",
    "list_agent_audit_events",
    "list_agent_tickets",
  ] as const;

  async execute(input: ExecutorInput): Promise<ExecutorOutput> {
    const { action, sandbox, userId, executionId, taskId } = input;
    const tool = action.tool;
    const params = action.params;

    try {
      // Read-only tools use executeAgentTool directly
      const readOnlyTools = new Set([
        "run_database_query",
        "list_notifications",
        "list_agent_audit_events",
        "list_agent_tickets",
      ]);

      if (readOnlyTools.has(tool)) {
        const result = await executeAgentTool(tool, params, userId);
        return {
          sandbox,
          action: { ...action, status: "done", result },
          success: true,
        };
      }

      // Mutation tools go through sandbox
      switch (tool) {
        case "update_user_profile":
          return await this.updateUserProfile(action, params, sandbox, userId, executionId, taskId);
        case "update_user_preferences":
          return await this.updateUserPreferences(action, params, sandbox, userId, executionId, taskId);
        case "update_notification_settings":
          return await this.updateNotificationSettings(action, params, sandbox, userId, executionId, taskId);
        case "mark_notification_read":
          return await this.markNotificationRead(action, params, sandbox, userId, executionId, taskId);
        case "clear_notification":
          return await this.clearNotification(action, params, sandbox, userId, executionId, taskId);
        default:
          throw new Error(`Unknown tool: ${tool}`);
      }
    } catch (err: any) {
      logError(`[GenericExecutor] ${tool} failed`, { error: err.message, taskId });
      return {
        sandbox,
        action: { ...action, status: "error", error: err.message },
        success: false,
        error: err.message,
      };
    }
  }

  /** Update user profile (sandboxed). */
  private async updateUserProfile(
    action: any,
    params: any,
    sandbox: any,
    userId: string,
    executionId: string,
    taskId: string
  ): Promise<ExecutorOutput> {
    const { updates, expectedUpdatedAt, idempotencyKey } = params;
    
    if (!updates) {
      throw new Error("update_user_profile requires updates");
    }

    // USER_SAFE_FIELDS allowlist (enforced at merge time too)
    const SAFE_FIELDS = ["name", "country", "language", "theme", "dateFormat", "timeFormat", "notificationSettings"];
    const safeUpdates: Record<string, any> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (SAFE_FIELDS.includes(key)) {
        safeUpdates[key] = value;
      }
    }

    if (Object.keys(safeUpdates).length === 0) {
      throw new Error("No allowed fields to update");
    }

    const updatedSandbox = { ...sandbox };
    updatedSandbox.updates = [...(sandbox.updates || []), {
      id: userId,
      updates: safeUpdates,
      expectedUpdatedAt: expectedUpdatedAt ? new Date(expectedUpdatedAt) : undefined,
      idempotencyKey: idempotencyKey || `user_profile_${Date.now()}`,
    }];

    await sandboxRedisStore.set(userId, executionId, updatedSandbox);

    logInfo("[GenericExecutor] User profile update queued", { taskId, fields: Object.keys(safeUpdates) });

    return {
      sandbox: updatedSandbox,
      action: { ...action, status: "done", result: { updated: true, fields: Object.keys(safeUpdates) } },
      success: true,
    };
  }

  /** Update user preferences (sandboxed). */
  private async updateUserPreferences(
    action: any,
    params: any,
    sandbox: any,
    userId: string,
    executionId: string,
    taskId: string
  ): Promise<ExecutorOutput> {
    const { preferences, expectedUpdatedAt, idempotencyKey } = params;
    
    if (!preferences) {
      throw new Error("update_user_preferences requires preferences");
    }

    const updatedSandbox = { ...sandbox };
    updatedSandbox.updates = [...(sandbox.updates || []), {
      id: userId,
      updates: { preferences },
      expectedUpdatedAt: expectedUpdatedAt ? new Date(expectedUpdatedAt) : undefined,
      idempotencyKey: idempotencyKey || `user_prefs_${Date.now()}`,
    }];

    await sandboxRedisStore.set(userId, executionId, updatedSandbox);

    logInfo("[GenericExecutor] User preferences update queued", { taskId });

    return {
      sandbox: updatedSandbox,
      action: { ...action, status: "done", result: { updated: true } },
      success: true,
    };
  }

  /** Update notification settings (sandboxed). */
  private async updateNotificationSettings(
    action: any,
    params: any,
    sandbox: any,
    userId: string,
    executionId: string,
    taskId: string
  ): Promise<ExecutorOutput> {
    const { settings, expectedUpdatedAt, idempotencyKey } = params;
    
    if (!settings) {
      throw new Error("update_notification_settings requires settings");
    }

    const updatedSandbox = { ...sandbox };
    updatedSandbox.updates = [...(sandbox.updates || []), {
      id: userId,
      updates: { notificationSettings: settings },
      expectedUpdatedAt: expectedUpdatedAt ? new Date(expectedUpdatedAt) : undefined,
      idempotencyKey: idempotencyKey || `notif_settings_${Date.now()}`,
    }];

    await sandboxRedisStore.set(userId, executionId, updatedSandbox);

    logInfo("[GenericExecutor] Notification settings update queued", { taskId });

    return {
      sandbox: updatedSandbox,
      action: { ...action, status: "done", result: { updated: true } },
      success: true,
    };
  }

  /** Mark notification as read (direct, reversible). */
  private async markNotificationRead(
    action: any,
    params: any,
    sandbox: any,
    userId: string,
    executionId: string,
    taskId: string
  ): Promise<ExecutorOutput> {
    const { notificationId } = params;
    
    if (!notificationId) {
      throw new Error("mark_notification_read requires notificationId");
    }

    // Direct write with audit (not sandboxed - reversible action)
    // This would call a notification service; for now we queue as a special update
    const updatedSandbox = { ...sandbox };
    updatedSandbox.updates = [...(sandbox.updates || []), {
      id: `notification:${notificationId}`,
      updates: { read: true, readAt: new Date() },
      idempotencyKey: `notif_read_${notificationId}`,
    }];

    await sandboxRedisStore.set(userId, executionId, updatedSandbox);

    logInfo("[GenericExecutor] Notification read queued", { taskId, notificationId });

    return {
      sandbox: updatedSandbox,
      action: { ...action, status: "done", result: { notificationId, read: true } },
      success: true,
    };
  }

  /** Clear notification (direct, reversible). */
  private async clearNotification(
    action: any,
    params: any,
    sandbox: any,
    userId: string,
    executionId: string,
    taskId: string
  ): Promise<ExecutorOutput> {
    const { notificationId } = params;
    
    if (!notificationId) {
      throw new Error("clear_notification requires notificationId");
    }

    const updatedSandbox = { ...sandbox };
    updatedSandbox.updates = [...(sandbox.updates || []), {
      id: `notification:${notificationId}`,
      updates: { cleared: true, clearedAt: new Date() },
      idempotencyKey: `notif_clear_${notificationId}`,
    }];

    await sandboxRedisStore.set(userId, executionId, updatedSandbox);

    logInfo("[GenericExecutor] Notification clear queued", { taskId, notificationId });

    return {
      sandbox: updatedSandbox,
      action: { ...action, status: "done", result: { notificationId, cleared: true } },
      success: true,
    };
  }

  async dryRun(action: any, skillContext: any): Promise<Record<string, unknown>> {
    const readOnly = new Set([
      "run_database_query",
      "list_notifications",
      "list_agent_audit_events",
      "list_agent_tickets",
    ]);
    
    return {
      tool: action.tool,
      params: action.params,
      preview: readOnly.has(action.tool) 
        ? `Would ${action.tool} (read-only)`
        : `Would ${action.tool} with params: ${JSON.stringify(action.params)}`,
    };
  }

  async cleanup(): Promise<void> {
    // No persistent resources
  }
}

/** Singleton instance. */
export const genericExecutor = new GenericExecutor();