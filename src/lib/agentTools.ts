import Form from "@/models/formModel";
import Response from "@/models/responseModel";
import CustomView from "@/models/customViewModel";
import Notification from "@/models/notificationModel";
import AgentAuditEvent from "@/models/agentAuditEventModel";
import AgentTicket from "@/models/agentTicketModel";
import User from "@/models/userModel";
import mongoose from "mongoose";
import type { AgentAction } from "@/agent/types";

// Phase 7: re-export the canonical AgentAction from src/agent/types so callers
// importing it from `@/lib/agentTools` keep working. The previous file
// declared a duplicate interface that drifted from the canonical one.
export type { AgentAction };

/**
 * Resolves the form_id filter for tenant-isolated queries.
 * Handles both MongoDB ObjectId (_id) and hashed formId string formats.
 * 
 * @param userId - The user's ObjectId string
 * @param queryFormId - The form_id from the query (can be ObjectId or hashed formId)
 * @param targetCollection - The collection being queried ("Form", "CustomView", or "Response")
 * @returns A MongoDB filter object for the appropriate field
 */
async function resolveFormIdFilter(
  userId: string,
  queryFormId: string | undefined,
  targetCollection: "Form" | "CustomView" | "Response"
): Promise<Record<string, any>> {
  // If no form_id in query, return all user's forms
  if (!queryFormId) {
    const userForms = await Form.find({ user: userId }).select("_id formId").lean();
    if (targetCollection === "Response") {
      // Response uses MongoDB _id
      const userFormIds = userForms.map(f => f._id);
      return { $in: userFormIds };
    } else if (targetCollection === "CustomView") {
      // CustomView uses hashed formId
      const userFormIds = userForms.map(f => f.formId);
      return { $in: userFormIds };
    } else {
      // Form collection: return both _id and formId for $or query
      const userFormObjectIds = userForms.map(f => f._id);
      const userFormHashedIds = userForms.map(f => f.formId);
      return { $or: [{ _id: { $in: userFormObjectIds } }, { formId: { $in: userFormHashedIds } }] };
    }
  }

  // Check if queryFormId is a valid MongoDB ObjectId
  const isValidObjectId = mongoose.Types.ObjectId.isValid(queryFormId);

  if (isValidObjectId) {
    // Query contains an ObjectId - match against _id field
    const userForms = await Form.find({ user: userId }).select("_id").lean();
    const userFormIds = userForms.map(f => f._id);
    
    if (targetCollection === "Response") {
      // Response.form_id stores MongoDB _id
      return { $in: userFormIds, $eq: new mongoose.Types.ObjectId(queryFormId) };
    } else if (targetCollection === "CustomView") {
      // CustomView uses hashed formId, but query has ObjectId - need to resolve
      // Find the form with this _id and get its formId
      const form = await Form.findOne({ _id: queryFormId, user: userId }).select("formId").lean();
      if (!form) return { $in: [], $eq: null }; // No match - return empty filter
      return { $in: [form.formId], $eq: form.formId };
    } else {
      // Form collection - match against _id
      return { $in: userFormIds, $eq: new mongoose.Types.ObjectId(queryFormId) };
    }
  } else {
    // Query contains a hashed formId string - match against formId field
    const userForms = await Form.find({ user: userId }).select("formId").lean();
    const userFormHashedIds = userForms.map(f => f.formId);
    
    if (targetCollection === "Response") {
      // Response.form_id stores MongoDB _id, but query has hashed formId
      // Need to resolve the hashed formId to _id
      const form = await Form.findOne({ formId: queryFormId, user: userId }).select("_id").lean();
      if (!form) return { $in: [], $eq: null }; // No match - return empty filter
      return { $in: [form._id], $eq: form._id };
    } else if (targetCollection === "CustomView") {
      // CustomView uses hashed formId
      return { $in: userFormHashedIds, $eq: queryFormId };
    } else {
      // Form collection - match against formId
      return { $in: userFormHashedIds, $eq: queryFormId };
    }
  }
}

export async function executeAgentTool(
  tool: string,
  params: any,
  userId: string
) {
  // Mutation tools must go through the sandbox → mergeSandboxToProduction path,
  // not executeAgentTool directly. This enforces the sandbox + idempotency-key +
  // transaction safety guardrails.
  if (tool === "create_form" || tool === "update_form" || tool === "delete_form") {
    throw new Error(
      `${tool} must go through the sandbox → mergeSandboxToProduction path, not executeAgentTool.`
    );
  }

  switch (tool) {
    case "run_database_query": {
      const { collection, operation, query, options = {} } = params;
      
      const allowedOperations = ["find", "findOne", "countDocuments", "aggregate"];
      if (!allowedOperations.includes(operation)) {
        throw new Error(`Operation ${operation} is not allowed. Only read operations are permitted.`);
      }

      let Model: mongoose.Model<any>;
      let parsedQuery = {};
      if (typeof query === "object" && query !== null) {
        parsedQuery = query;
      } else if (typeof query === "string") {
        try {
          parsedQuery = JSON.parse(query);
        } catch (e1: any) {
          try {
            // Sanitize single quotes and JS expressions like new Date() or unquoted keys
            const sanitized = query
              .replace(/'/g, '"')
              .replace(/new Date\(\)/g, `"${new Date().toISOString()}"`);
            parsedQuery = JSON.parse(sanitized);
          } catch (e2: any) {
            throw new Error(`Failed to parse database query as JSON. Ensure it is valid JSON. Error: ${e2.message}. Query was: ${query}`);
          }
        }
      }
      let secureQuery: Record<string, any> = { ...parsedQuery };

      if (collection === "Form") {
        Model = Form;
        secureQuery.user = userId; // Force Tenant Isolation
        
        // Apply form_id intersect guard for Form collection
        if (query.form_id) {
          const formIdFilter = await resolveFormIdFilter(userId, query.form_id, "Form");
          // Form collection can be queried by _id or formId
          if (formIdFilter.$or) {
            secureQuery.$or = formIdFilter.$or;
          } else if (formIdFilter.$in && formIdFilter.$eq) {
            secureQuery.$or = [
              { _id: formIdFilter },
              { formId: formIdFilter }
            ];
          } else {
            secureQuery.$or = [
              { _id: formIdFilter },
              { formId: formIdFilter }
            ];
          }
        }
      } else if (collection === "CustomView") {
        Model = CustomView;
        secureQuery.user = userId; // Force Tenant Isolation
        
        // Apply form_id intersect guard for CustomView collection
        if (query.form_id) {
          const formIdFilter = await resolveFormIdFilter(userId, query.form_id, "CustomView");
          // CustomView uses formId field
          if (formIdFilter.$in && formIdFilter.$eq) {
            secureQuery.formId = formIdFilter;
          } else if (formIdFilter.$in) {
            secureQuery.formId = formIdFilter;
          }
        }
      } else if (collection === "Response") {
        Model = Response;
        // For Responses, we must ensure the form_id belongs to the user.
        
        // Apply form_id intersect guard for Response collection
        if (query.form_id) {
          const formIdFilter = await resolveFormIdFilter(userId, query.form_id, "Response");
          // Response uses form_id field (MongoDB _id)
          if (formIdFilter.$in && formIdFilter.$eq) {
            secureQuery.form_id = formIdFilter;
          } else if (formIdFilter.$in) {
            secureQuery.form_id = formIdFilter;
          }
        } else {
          // No form_id in query - restrict to user's forms
          const userForms = await Form.find({ user: userId }).select("_id").lean();
          const userFormIds = userForms.map(f => f._id);
          secureQuery.form_id = { $in: userFormIds };
        }
      } else {
        throw new Error(`Collection ${collection} is not supported for generic querying.`);
      }

      if (operation === "aggregate") {
        // Enforce a $match as the first stage for tenant isolation
        const pipeline = [
          { $match: secureQuery },
          ...(Array.isArray(query) ? query : [])
        ];
        const results = await Model.aggregate(pipeline);
        return { results };
      }

      // Execute Mongoose Read Operation
      let queryBuilder: any = (Model as any)[operation as "find" | "findOne" | "countDocuments"](secureQuery);
      
      if (operation === "find") {
        if (options?.sort) queryBuilder = queryBuilder.sort(options.sort);
        if (options?.limit) {
          queryBuilder = queryBuilder.limit(options.limit);
        } else {
          // Default limit to prevent massive payload crashing SSE stream / LLM context
          queryBuilder = queryBuilder.limit(50);
        }
        if (options?.skip) queryBuilder = queryBuilder.skip(options.skip);
      }

      const rawResults = await queryBuilder.lean().exec();
      let results = rawResults;
      
      // Sanitize results to avoid leaking internal schema (like normalized_data, metadata)
      if (Array.isArray(results)) {
        if (collection === "Response") {
          results = results.map((r: any) => ({
            id: String(r._id),
            form_id: String(r.form_id),
            data: r.data,
            submitted_at: r.submitted_at,
          }));
        } else {
          results = results.map((r: any) => {
            const { __v, normalized_data, ...rest } = r;
            return rest;
          });
        }
      } else if (results && typeof results === "object") {
        if (collection === "Response") {
          results = {
            id: String(results._id),
            form_id: String(results.form_id),
            data: results.data,
            submitted_at: results.submitted_at,
          };
        } else {
          const { __v, normalized_data, ...rest } = results as any;
          results = rest;
        }
      }

      return { results };
    }

    // B-S2.1: Element-level operations on forms (executed via sandbox in executor.ts)
    case "add_form_element":
    case "update_form_element":
    case "remove_form_element":
    case "reorder_form_elements":
      throw new Error(`${tool} is a sandboxed mutation — must be dispatched through the Executor persona.`);

    // B-S2.2: Form lifecycle (sandboxed — handled in executor.ts)
    case "set_form_status":
    case "update_form_metadata_settings":
      throw new Error(`${tool} is a sandboxed mutation — must be dispatched through the Executor persona.`);

    // B-S2.3: User/account (sandboxed — handled in executor.ts)
    case "update_user_profile":
    case "update_user_preferences":
    case "update_notification_settings":
      throw new Error(`${tool} is a sandboxed mutation — must be dispatched through the Executor persona.`);

    // B-S2.4: Notifications — exempt from sandbox per spec §3.1 (reversible, direct-write with audit)
    case "list_notifications": {
      const unreadOnly = params.unreadOnly === true;
      const limit = Math.min(Number(params.limit) || 20, 50);
      const filter: Record<string, any> = { user: userId };
      if (unreadOnly) filter.read = false;
      const notifications = await Notification.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
      return { results: notifications.map((n: any) => ({ id: String(n._id), type: n.type, message: n.message, read: n.read, relatedForm: n.relatedForm ? String(n.relatedForm) : null, triggeredAt: n.triggeredAt, createdAt: n.createdAt })) };
    }
    case "mark_notification_read": {
      const nid = params.notificationId;
      if (!nid || typeof nid !== "string") throw new Error("notificationId is required.");
      const notif = await Notification.findOne({ _id: nid, user: userId });
      if (!notif) throw new Error("Notification not found or access denied.");
      if (!notif.read) { notif.read = true; await notif.save(); }
      await AgentAuditEvent.create({ ticketId: "direct_notification", userId, resourceId: String(notif._id), action: "mark_notification_read", serverDiff: { read: true }, outcome: "success" });
      return { id: String(notif._id), read: true };
    }
    case "clear_notification": {
      const nid = params.notificationId;
      if (!nid || typeof nid !== "string") throw new Error("notificationId is required.");
      const notif = await Notification.findOne({ _id: nid, user: userId });
      if (!notif) throw new Error("Notification not found or access denied.");
      await Notification.deleteOne({ _id: nid, user: userId });
      await AgentAuditEvent.create({ ticketId: "direct_notification", userId, resourceId: String(notif._id), action: "clear_notification", serverDiff: { message: notif.message }, outcome: "success" });
      return { id: String(notif._id), cleared: true };
    }

    // B-S2.5: Dashboard and audit reads
    case "dashboard_stats": {
      const totalForms = await Form.countDocuments({ user: userId });
      const userForms = await Form.find({ user: userId }).select("_id").lean();
      const formIds = userForms.map((f: any) => f._id);
      const totalResponses = await Response.countDocuments({ form_id: { $in: formIds } });
      const activeForms = await Form.countDocuments({ user: userId, status: 0 });
      const archivedForms = await Form.countDocuments({ user: userId, status: 2 });
      return { results: { totalForms, totalResponses, activeForms, archivedForms } };
    }
    case "list_agent_audit_events": {
      const limit = Math.min(Number(params.limit) || 20, 100);
      const filter: Record<string, any> = { userId };
      if (params.action) filter.action = params.action;
      const events = await AgentAuditEvent.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
      return { results: events.map((e: any) => ({ id: String(e._id), ticketId: e.ticketId, resourceId: e.resourceId, action: e.action, outcome: e.outcome, createdAt: e.createdAt })) };
    }
    case "list_agent_tickets": {
      const limit = Math.min(Number(params.limit) || 20, 100);
      const filter: Record<string, any> = { userId };
      if (params.status) filter.status = params.status;
      const tickets = await AgentTicket.find(filter).sort({ createdAt: -1 }).limit(limit).select("ticketId title stage status createdAt").lean();
      return { results: tickets.map((t: any) => ({ ticketId: t.ticketId, title: t.title, stage: t.stage, status: t.status, createdAt: t.createdAt })) };
    }

    // B-S2.6: Export form — returns HMAC-signed URL with 5-min TTL
    case "export_form": {
      const { createHmac } = await import("crypto");
      const format = params.format;
      if (!["csv", "json", "pdf"].includes(format)) throw new Error("Format must be csv, json, or pdf.");
      const formId = params.formId;
      if (!formId || typeof formId !== "string") throw new Error("formId is required.");
      let formFilter: any = { user: userId };
      if (mongoose.Types.ObjectId.isValid(formId)) { formFilter._id = formId; }
      else { formFilter.formId = formId; }
      const form = await Form.findOne(formFilter).select("_id formId").lean();
      if (!form) throw new Error("Form not found or access denied.");
      const TOKEN_SECRET = process.env.TOKEN_SECRET || "export-signing-secret";
      const expiresAt = Date.now() + 5 * 60 * 1000;
      const payload = JSON.stringify({ formId: String(form.formId || form._id), format, userId, exp: expiresAt });
      const signature = createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex");
      const signedUrl = `/api/export/download?payload=${Buffer.from(payload).toString("base64url")}&sig=${signature}`;
      return { signedUrl, expiresAt: new Date(expiresAt).toISOString(), format };
    }

    default:
      throw new Error(`Unknown or unauthorized tool action: ${tool}`);
  }
}
