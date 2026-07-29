# API & Tool Usage Guidelines

This document specifies data parameter schemas, field types, and rules required for tool execution.

---

## Tool Schemas & Parameter Guidelines

### 1. `create_form`
- **Parameters**:
  - `name`: string (Required, max 100 chars)
  - `description`: string (Optional, max 500 chars)
  - `expiry`: ISO Date string (Default: +30 days)
  - `elements`: Array of FormElement objects:
    - `label`: string (Required)
    - `type`: number (1=Text, 2=Number, 3=Select, 4=Textarea, 5=Date)
    - `required`: boolean (Default: false)
    - `options`: Array of `{ id, label, value }` (Required if type=3)

### 2. `update_form`
- **Parameters**:
  - `formId`: string (Required)
  - `updates`: Object containing `name`, `description`, `elements`, or `status`.

### 3. `query_responses`
- **Parameters**:
  - `formId`: string (Required)
  - `filters`: Array of filter objects:
    - `field`: string (e.g. "Full Name", "Rating", "Email")
    - `operator`: "equals" | "contains" | "gt" | "gte" | "lt" | "lte" | "ne"
    - `value`: any
  - `page`: number (Default: 1)
  - `limit`: number (Default: 50)

### 4. `create_custom_view`
- **Parameters**:
  - `formId`: string (Required)
  - `name`: string (Required)
  - `filters`: Array of filter objects
  - `sortField`: string (Default: "submitted_at")
  - `sortOrder`: "asc" | "desc" (Default: "desc")
