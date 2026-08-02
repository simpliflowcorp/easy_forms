export const agentToolsSchema = [
  {
    type: "function",
    function: {
      name: "create_form",
      description: "Create a new form with specific fields. Used when the user wants to build a new form.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The title of the form" },
          description: { type: "string", description: "A short description of the form" },
          expiryDays: { type: "number", description: "The lifetime or expiry of the form in days (e.g. 4 for 4 days)" },
          elements: {
            type: "array",
            description: "List of fields to include in the form",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "The field label (e.g. Full Name)" },
                type: { type: "number", description: "1 for Text, 2 for Number, 3 for Select" },
                required: { type: "boolean" }
              },
              required: ["label", "type", "required"]
            }
          }
        },
        required: ["name", "description", "elements"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_form",
      description: "Update an existing form schema or properties",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "The ID of the form to update" },
          updates: { type: "object", description: "The fields to update (e.g., name, description, elements, status)" }
        },
        required: ["formId", "updates"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_form",
      description: "Delete an existing form.",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "The ID of the form to delete" }
        },
        required: ["formId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_database_query",
      description: "Run a read-only MongoDB query to retrieve or count data. The query is strictly isolated to the current user's data.",
      parameters: {
        type: "object",
        properties: {
          collection: { type: "string", description: "The database collection to query (Form, Response, CustomView)" },
          operation: { type: "string", description: "The Mongoose operation to run: 'find', 'findOne', 'countDocuments', or 'aggregate'" },
          query: { type: "object", description: "The MongoDB filter/query object (e.g., { status: 1 } to find active forms)" },
          options: { type: "object", description: "Optional query options (e.g. limit, sort). Do not use this for aggregate." }
        },
        required: ["collection", "operation", "query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "query_responses",
      description: "Fetch form responses with optional filters, pagination, and sort. Use for any 'show me responses for form X' request.",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "The form's hashed formId or Mongo _id" },
          filters: {
            type: "array",
            description: "Optional list of filter predicates to apply",
            items: {
              type: "object",
              properties: {
                field: { type: "string", description: "The form-field label to filter on (e.g. 'Full Name', 'Rating')" },
                operator: { type: "string", enum: ["equals", "contains", "gt", "gte", "lt", "lte", "ne"], description: "Comparison operator" },
                value: { description: "The value to compare against (any JSON type)" }
              },
              required: ["field", "operator", "value"]
            }
          },
          page: { type: "number", description: "1-indexed page number (default 1)" },
          limit: { type: "number", description: "Page size (default 50, max 50)" }
        },
        required: ["formId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_analytics",
      description: "Compute aggregate analytics for a form (counts, averages, group-bys, distributions). Read-only.",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "The form's hashed formId or Mongo _id" },
          metrics: { type: "array", description: "Optional list of metric specs; if omitted, returns a default summary", items: { type: "string" } }
        },
        required: ["formId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_custom_view",
      description: "Save a named set of filters + sort as a reusable custom view for a form. The view is scoped to the user.",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "The form this view belongs to" },
          name: { type: "string", description: "Human-readable view name (max 100 chars)" },
          filters: {
            type: "array",
            description: "Filter predicates to apply when the view is opened",
            items: {
              type: "object",
              properties: {
                field: { type: "string" },
                operator: { type: "string", enum: ["equals", "contains", "gt", "gte", "lt", "lte", "ne"] },
                value: {}
              },
              required: ["field", "operator", "value"]
            }
          },
          sortField: { type: "string", description: "Field to sort by (default 'submitted_at')" },
          sortOrder: { type: "string", enum: ["asc", "desc"], description: "Sort direction (default 'desc')" }
        },
        required: ["formId", "name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_custom_view",
      description: "Update an existing custom view's filters, name, or sort. Mutating — routed through the sandbox.",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "The form the view belongs to" },
          name: { type: "string", description: "The existing view's name (identifies the view to update)" },
          filters: { type: "array", description: "Replacement filter predicates", items: { type: "object" } },
          sortField: { type: "string" },
          sortOrder: { type: "string", enum: ["asc", "desc"] }
        },
        required: ["formId", "name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_custom_view",
      description: "Delete a named custom view from a form. Mutating — routed through the sandbox.",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "The form the view belongs to" },
          name: { type: "string", description: "The view name to delete" }
        },
        required: ["formId", "name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_custom_views",
      description: "List the user's saved custom views for a form. Read-only.",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "The form whose views to list" }
        },
        required: ["formId"]
      }
    }
  }
];
