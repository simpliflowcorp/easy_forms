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
  }
];
