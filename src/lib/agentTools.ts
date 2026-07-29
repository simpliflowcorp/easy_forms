import Form from "@/models/formModel";
import Response from "@/models/responseModel";
import CustomView from "@/models/customViewModel";
import mongoose from "mongoose";

export interface AgentAction {
  id: string;
  tool: string;
  description: string;
  params: any;
  status: "pending" | "in_progress" | "done" | "error" | "awaiting_confirmation";
  requiresConfirmation?: boolean;
  result?: any;
  error?: string;
}

export const TOOL_DEFINITIONS = [
  {
    name: "create_form",
    description: "Create a new form with fields and elements",
    requiresConfirmation: false,
  },
  {
    name: "update_form",
    description: "Update an existing form schema or properties",
    requiresConfirmation: false,
  },
  {
    name: "read_form",
    description: "Retrieve schema details of a form",
    requiresConfirmation: false,
  },
  {
    name: "delete_form",
    description: "Permanently delete a form",
    requiresConfirmation: true,
  },
  {
    name: "query_responses",
    description: "Filter and read form response submissions",
    requiresConfirmation: false,
  },
  {
    name: "generate_analytics",
    description: "Compute response stats and analytics metrics",
    requiresConfirmation: false,
  },
  {
    name: "create_custom_view",
    description: "Save a custom table view filter preset",
    requiresConfirmation: false,
  },
  {
    name: "get_custom_views",
    description: "Fetch saved table views for a form",
    requiresConfirmation: false,
  },
  {
    name: "update_custom_view",
    description: "Update filter criteria of a custom view",
    requiresConfirmation: false,
  },
  {
    name: "delete_custom_view",
    description: "Delete a saved custom table view",
    requiresConfirmation: true,
  },
  {
    name: "count_forms",
    description: "Count the number of active and total forms for a user",
    requiresConfirmation: false,
  },
];

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

    case "read_form": {
      const { formId } = params;
      const form = await Form.findOne({
        $or: [
          { formId: formId },
          { _id: mongoose.Types.ObjectId.isValid(formId) ? formId : null },
        ],
        user: userId,
      });
      if (!form) throw new Error("Form not found or access denied");
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

    case "query_responses": {
      const { formId, filters, page = 1, limit = 50 } = params;
      const form = await Form.findOne({
        $or: [
          { formId: formId },
          { _id: mongoose.Types.ObjectId.isValid(formId) ? formId : null },
        ],
        user: userId,
      });
      if (!form) throw new Error("Form not found or access denied");

      const queryCond: any = { form_id: form._id };

      if (filters && Array.isArray(filters)) {
        filters.forEach((f: any) => {
          const key = f.field.startsWith("data.") ? f.field : `data.${f.field}`;
          if (f.operator === "equals") queryCond[key] = f.value;
          else if (f.operator === "contains") queryCond[key] = { $regex: f.value, $options: "i" };
          else if (f.operator === "gt") queryCond[key] = { $gt: f.value };
          else if (f.operator === "gte") queryCond[key] = { $gte: f.value };
          else if (f.operator === "lt") queryCond[key] = { $lt: f.value };
          else if (f.operator === "lte") queryCond[key] = { $lte: f.value };
          else if (f.operator === "ne") queryCond[key] = { $ne: f.value };
        });
      }

      const total = await Response.countDocuments(queryCond);
      const responses = await Response.find(queryCond)
        .sort({ submitted_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      return { form, total, responses, filtersApplied: filters || [] };
    }

    case "generate_analytics": {
      const { formId } = params;
      const form = await Form.findOne({
        $or: [
          { formId: formId },
          { _id: mongoose.Types.ObjectId.isValid(formId) ? formId : null },
        ],
        user: userId,
      });
      if (!form) throw new Error("Form not found or access denied");

      const totalResponses = await Response.countDocuments({ form_id: form._id });

      const responseList = await Response.find({ form_id: form._id }).lean();

      const elementStats: Record<string, any> = {};
      form.elements.forEach((el: any) => {
        elementStats[el.label] = {
          elementId: el.elementId,
          type: el.type,
          count: 0,
          values: {} as Record<string, number>,
        };
      });

      responseList.forEach((r: any) => {
        if (r.data && typeof r.data === "object") {
          Object.entries(r.data).forEach(([key, val]) => {
            if (elementStats[key]) {
              elementStats[key].count++;
              const strVal = String(val);
              elementStats[key].values[strVal] = (elementStats[key].values[strVal] || 0) + 1;
            }
          });
        }
      });

      return {
        formId: form.formId,
        formName: form.name,
        totalResponses,
        elementStats,
      };
    }

    case "create_custom_view": {
      const { formId, name, filters, sortField, sortOrder, visibleColumns } = params;
      const view = await CustomView.create({
        user: userId,
        formId,
        name: name || "Custom View",
        filters: filters || [],
        sortField: sortField || "submitted_at",
        sortOrder: sortOrder || "desc",
        visibleColumns: visibleColumns || [],
      });
      return { view };
    }

    case "get_custom_views": {
      const { formId } = params;
      const views = await CustomView.find({ user: userId, formId }).sort({ createdAt: -1 });
      return { views };
    }

    case "update_custom_view": {
      const { viewId, name, filters, sortField, sortOrder, visibleColumns } = params;
      const view = await CustomView.findOne({ _id: viewId, user: userId });
      if (!view) throw new Error("Custom view not found or access denied");

      if (name) view.name = name;
      if (filters) view.filters = filters;
      if (sortField) view.sortField = sortField;
      if (sortOrder) view.sortOrder = sortOrder;
      if (visibleColumns) view.visibleColumns = visibleColumns;

      await view.save();
      return { view };
    }

    case "delete_custom_view": {
      const { viewId } = params;
      const result = await CustomView.deleteOne({ _id: viewId, user: userId });
      if (result.deletedCount === 0) throw new Error("Custom view not found");
      return { success: true, viewId };
    }

    case "count_forms": {
      const activeCount = await Form.countDocuments({ user: userId, status: 1 });
      const totalCount = await Form.countDocuments({ user: userId });
      return { activeCount, totalCount };
    }

    default:
      throw new Error(`Unknown or unauthorized tool action: ${tool}`);
  }
}
