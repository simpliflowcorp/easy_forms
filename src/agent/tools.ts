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
  },
  // B-S2.1: Element-level operations for forms
  {
    type: "function",
    function: {
      name: "add_form_element",
      description: "Add a new field/element to an existing form.",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "The ID of the form to modify" },
          element: {
            type: "object",
            description: "The element to add",
            properties: {
              label: { type: "string", description: "The field label" },
              type: { type: "number", description: "1=Text, 2=Number, 3=Select, 4=Textarea, 5=Date" },
              required: { type: "boolean" },
              options: {
                type: "array",
                description: "Required for type=3 (Select): array of {label, value}",
                items: { type: "object" }
              }
            },
            required: ["label", "type", "required"]
          }
        },
        required: ["formId", "element"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_form_element",
      description: "Update an existing field/element in a form by its elementId or label.",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "The ID of the form" },
          elementId: { type: "string", description: "The elementId of the element to update (preferred)" },
          label: { type: "string", description: "Fallback: match element by label if elementId is not known" },
          updates: { type: "object", description: "Fields to update on the element (label, type, required, options, position, column)" }
        },
        required: ["formId", "updates"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "remove_form_element",
      description: "Remove a field/element from an existing form by its elementId or label.",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "The ID of the form" },
          elementId: { type: "string", description: "The elementId to remove (preferred)" },
          label: { type: "string", description: "Fallback: match element by its label" }
        },
        required: ["formId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "reorder_form_elements",
      description: "Change the display order of form elements by setting new positions.",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "The ID of the form" },
          order: {
            type: "array",
            description: "Array of { elementId, newPosition } dictating the new order",
            items: {
              type: "object",
              properties: {
                elementId: { type: "string" },
                newPosition: { type: "number" }
              },
              required: ["elementId", "newPosition"]
            }
          }
        },
        required: ["formId", "order"]
      }
    }
  },
  // B-S2.2: Form lifecycle tools
  {
    type: "function",
    function: {
      name: "set_form_status",
      description: "Change a form's status (0=active, 1=paused/draft, 2=archived).",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "The ID of the form" },
          status: { type: "number", description: "0=active, 1=paused, 2=archived" }
        },
        required: ["formId", "status"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_form_metadata_settings",
      description: "Configure metadata capture settings for a form (IP, user agent, geolocation, referrer).",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "The ID of the form" },
          settings: {
            type: "object",
            description: "Metadata flags to update",
            properties: {
              ip: { type: "boolean" },
              userAgent: { type: "boolean" },
              geolocation: { type: "boolean" },
              referrer: { type: "boolean" }
            }
          }
        },
        required: ["formId", "settings"]
      }
    }
  },
  // B-S2.3: User/account tools
  {
    type: "function",
    function: {
      name: "update_user_profile",
      description: "Update the current user's profile fields (firstName, lastName, phoneNumber, address, city, state, country, zipCode, about, website).",
      parameters: {
        type: "object",
        properties: {
          profile: {
            type: "object",
            description: "Profile fields to update (only safe fields allowed)",
            properties: {
              firstName: { type: "string" },
              lastName: { type: "string" },
              phoneNumber: { type: "string" },
              address: { type: "string" },
              city: { type: "string" },
              state: { type: "string" },
              country: { type: "string" },
              zipCode: { type: "string" },
              about: { type: "string" },
              website: { type: "string" }
            }
          }
        },
        required: ["profile"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_user_preferences",
      description: "Update user preferences (dateFormat, language, country, timeFormat).",
      parameters: {
        type: "object",
        properties: {
          preferences: {
            type: "object",
            description: "Preferences to update",
            properties: {
              dateFormat: { type: "string" },
              language: { type: "string" },
              country: { type: "string" },
              timeFormat: { type: "string" }
            }
          }
        },
        required: ["preferences"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_notification_settings",
      description: "Update notification preferences (popup and email notification toggles).",
      parameters: {
        type: "object",
        properties: {
          settings: {
            type: "object",
            description: "Notification settings",
            properties: {
              popup: {
                type: "object",
                properties: {
                  formExpired: { type: "boolean" },
                  newResponseAlert: { type: "boolean" }
                }
              },
              email: {
                type: "object",
                properties: {
                  formExpired: { type: "boolean" },
                  newResponseAlert: { type: "boolean" },
                  responseSummary: { type: "boolean" }
                }
              }
            }
          }
        },
        required: ["settings"]
      }
    }
  },
  // B-S2.4: Notification tools (exempt from sandbox — direct write with audit)
  {
    type: "function",
    function: {
      name: "list_notifications",
      description: "List notifications for the current user, optionally filtered by read/unread status.",
      parameters: {
        type: "object",
        properties: {
          unreadOnly: { type: "boolean", description: "If true, only return unread notifications" },
          limit: { type: "number", description: "Max notifications to return (default 20)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "mark_notification_read",
      description: "Mark a specific notification as read. Direct write — no sandbox (notifications are reversible).",
      parameters: {
        type: "object",
        properties: {
          notificationId: { type: "string", description: "The notification's ID" }
        },
        required: ["notificationId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "clear_notification",
      description: "Delete a specific notification. Direct write — no sandbox (notifications are reversible).",
      parameters: {
        type: "object",
        properties: {
          notificationId: { type: "string", description: "The notification's ID" }
        },
        required: ["notificationId"]
      }
    }
  },
  // B-S2.5: Dashboard and audit reads
  {
    type: "function",
    function: {
      name: "dashboard_stats",
      description: "Get dashboard statistics (total forms, responses, views, recent activity). Read-only.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_agent_audit_events",
      description: "List agent audit events for the current user. Read-only.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max events to return (default 20)" },
          action: { type: "string", description: "Filter by action type" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_agent_tickets",
      description: "List agent interaction tickets for the current user. Read-only.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max tickets to return (default 20)" },
          status: { type: "string", description: "Filter by ticket status" }
        }
      }
    }
  },
  // B-S2.6: Export tool
  {
    type: "function",
    function: {
      name: "export_form",
      description: "Export form responses as CSV, JSON, or PDF. Returns a short-lived (5-min) HMAC-signed download URL — NOT inline bytes.",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "The ID of the form to export" },
          format: { type: "string", enum: ["csv", "json", "pdf"], description: "Export format" }
        },
        required: ["formId", "format"]
      }
    }
  }
];
