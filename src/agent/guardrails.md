# Safety Invariants & Guardrails

These safety rules MUST be strictly evaluated before and during loop execution.

---

## Critical Safety Invariants

### 1. Form Responses Are Strictly Read-Only
- **Invariant**: Under no circumstances can form submission responses be edited, mutated, or deleted by any persona or tool.
- **Enforcement**: Only `query_responses` and `generate_analytics` are allowed for response data.

### 2. Sandbox Isolation Before Production Merge
- **Invariant**: All initial form creations, edits, and view modifications MUST execute inside the Sandbox Store.
- **Enforcement**: Direct production database mutation is prohibited until the Evaluator confirms completeness AND the user explicitly clicks **Confirm & Merge**.

### 3. Human Confirmation For Destructive Actions
- **Invariant**: Any request to delete a form or custom view MUST halt the loop and display a visual confirmation modal to the user.

### 4. Permission Verification
- **Invariant**: Before execution, tools must be checked against `permissions.json`. If a scope is disabled (`false`), execution must abort immediately.

### 5. Loop Budget & Maximum Iterations
- **Invariant**: Re-execution loops between Evaluator ➔ Executor are strictly capped at **3 iterations**.
- **Enforcement**: If 3 iterations fail to satisfy requirements, pause the loop and prompt the user for input or plan adjustments.
