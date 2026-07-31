import Form from "@/models/formModel";
import Response from "@/models/responseModel";
import CustomView from "@/models/customViewModel";
import mongoose from "mongoose";
import type { AgentAction } from "@/agent/types";

// Phase 7: re-export the canonical AgentAction from src/agent/types so callers
// importing it from `@/lib/agentTools` keep working. The previous file
// declared a duplicate interface that drifted from the canonical one.
export type { AgentAction };

export async function executeAgentTool(
  tool: string,
  params: any,
  userId: string
) {
  switch (tool) {
    case "create_form": {
      const newForm = await Form.create({
        user: userId,
        name: params.name || "Untitled Form",
        description: params.description || "",
        expiry: params.expiry || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        elements: (params.elements || []).map((el: any, idx: number) => ({
          elementId: el.elementId || `field_${Date.now()}_${idx}`,
          type: el.type ?? 1,
          label: el.label || `Field ${idx + 1}`,
          required: Boolean(el.required),
          unique: Boolean(el.unique),
          options: el.options || [],
          position: idx + 1,
          column: el.column ?? 1,
        })),
        status: params.status ?? 1,
      });
      return { form: newForm };
    }

    case "update_form": {
      const { formId, updates } = params;
      const form = await Form.findOne({
        $or: [
          { formId: formId },
          { _id: mongoose.Types.ObjectId.isValid(formId) ? formId : null },
        ],
        user: userId,
      });

      if (!form) throw new Error("Form not found or access denied");

      if (updates.name) form.name = updates.name;
      if (updates.description !== undefined) form.description = updates.description;
      if (updates.elements) form.elements = updates.elements;
      if (updates.status !== undefined) form.status = updates.status;

      await form.save();
      return { form };
    }

    case "delete_form": {
      const { formId } = params;
      const result = await Form.deleteOne({
        $or: [
          { formId: formId },
          { _id: mongoose.Types.ObjectId.isValid(formId) ? formId : null },
        ],
        user: userId,
      });
      if (result.deletedCount === 0) throw new Error("Form not found or already deleted");
      return { success: true, formId };
    }

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
        } catch {
          try {
            // Sanitize single quotes and JS expressions like new Date() or unquoted keys
            const sanitized = query
              .replace(/'/g, '"')
              .replace(/new Date\(\)/g, `"${new Date().toISOString()}"`);
            parsedQuery = JSON.parse(sanitized);
          } catch {
            parsedQuery = {};
          }
        }
      }
      let secureQuery: Record<string, any> = { ...parsedQuery };

      if (collection === "Form") {
        Model = Form;
        secureQuery.user = userId; // Force Tenant Isolation
      } else if (collection === "CustomView") {
        Model = CustomView;
        secureQuery.user = userId; // Force Tenant Isolation
      } else if (collection === "Response") {
        Model = Response;
        // For Responses, we must ensure the form_id belongs to the user.
        // First fetch all form IDs owned by the user.
        const userForms = await Form.find({ user: userId }).select("_id").lean();
        const userFormIds = userForms.map(f => f._id);

        // #24 fix: intersect any LLM-supplied `form_id` filter with the
        // user's owned set instead of OVERWRITING the secure `$in` filter.
        // Previously:
        //   secureQuery.form_id = { $in: userFormIds };
        //   if (query.form_id) {
        //     secureQuery.form_id = query.form_id;   // ❌ cross-tenant leak
        //   }
        // A user (or a sufficiently persuasive prompt) asking "show me
        // responses for formObjectId=<victim's id>" would have received the
        // victim's data. Now the intersection guarantees that if the asked
        // id is NOT among the user's owned forms, the result set is empty.
        if (query.form_id) {
          secureQuery.form_id = {
            $in: userFormIds,
            $eq: query.form_id,
          };
        } else {
          secureQuery.form_id = { $in: userFormIds };
        }
      } else {
        throw new Error(`Collection ${collection} is not supported for generic querying.`);
      }

      // #24 fix: same intersect guard for `Form` / `CustomView` when the LLM
      // submitted a `form_id` it expects to filter on. Without this, asking
      // the agent about a specific form ID would bypass the per-user
      // `secureQuery.user = userId` we set earlier — well, `user` is still
      // there, but the `form_id` clause must also be scoped to user-owned
      // ids or the intersection with `user` is meaningless.
      if ((collection === "Form" || collection === "CustomView") && query.form_id) {
        const userForms = await Form.find({ user: userId }).select("_id").lean();
        const userFormIds = userForms.map(f => f._id);
        secureQuery.form_id = {
          $in: userFormIds,
          $eq: query.form_id,
        };
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
      
      if (operation === "find" && options) {
        if (options.sort) queryBuilder = queryBuilder.sort(options.sort);
        if (options.limit) queryBuilder = queryBuilder.limit(options.limit);
        if (options.skip) queryBuilder = queryBuilder.skip(options.skip);
      }

      const results = await queryBuilder.lean().exec();
      return { results };
    }

    default:
      throw new Error(`Unknown or unauthorized tool action: ${tool}`);
  }
}
