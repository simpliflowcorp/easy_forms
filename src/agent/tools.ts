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
      name: "count_forms",
      description: "Retrieve the total count and active count of forms for the user. Used when the user asks how many forms they have.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "query_responses",
      description: "Filter and query form submissions.",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "The ID of the form to query" },
          filters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field: { type: "string" },
                operator: { type: "string" },
                value: { type: "string" }
              }
            }
          }
        },
        required: ["formId"]
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
  }
];
